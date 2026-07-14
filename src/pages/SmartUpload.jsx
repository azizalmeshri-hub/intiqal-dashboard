import { useEffect, useMemo, useState } from 'react'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { writeAuditLog } from '../lib/auditLog'
import { formatProjectName } from '../lib/employees'

const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

const EMPTY_SINGLE = {
  direction: 'supplier',
  invoice_no: '',
  invoice_date: '',
  due_date: '',
  supplier_or_client_name: '',
  amount_net: '',
  vat_amount: '',
  amount_gross: '',
  currency: 'SAR',
  confidence_notes: {},
}

const EMPTY_STATEMENT_ROW = {
  include: true,
  date: '',
  description: '',
  invoice_no: '',
  debit: '',
  credit: '',
  running_balance: '',
  classification: 'invoice',
  project_id: '',
}

function mapArabicDigits(input) {
  const map = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
    '٫': '.',
    '٬': ',',
  }
  return String(input || '').replace(/[٠-٩٫٬]/g, (char) => map[char] || char)
}

function parseAmount(input) {
  const normalized = mapArabicDigits(input)
  const stripped = normalized.replace(/[^0-9.-]/g, '')
  const n = Number(stripped)
  return Number.isFinite(n) ? n : 0
}

function toAmountInput(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : ''
}

function normalizeDate(input) {
  if (!input) return ''
  const cleaned = mapArabicDigits(input).trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
    const [d, m, y] = cleaned.split('/')
    return `${y}-${m}-${d}`
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(cleaned)) {
    const [d, m, y] = cleaned.split('-')
    return `${y}-${m}-${d}`
  }

  const d = new Date(cleaned)
  if (!Number.isFinite(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function normalizeDirection(value) {
  const v = String(value || '').toLowerCase()
  if (v.includes('client') || v.includes('from us') || v.includes('عميل')) return 'client'
  return 'supplier'
}

function inferClassification(row) {
  const debit = parseAmount(row.debit)
  const credit = parseAmount(row.credit)
  if (credit > 0 && debit <= 0) return 'payment'
  return 'invoice'
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function modeOptions(lang) {
  return [
    { value: 'single', label: lang === 'ar' ? 'فاتورة واحدة' : 'Single invoice' },
    { value: 'statement', label: lang === 'ar' ? 'كشف حساب (عدة قيود)' : 'Account statement (many rows)' },
  ]
}

export default function SmartUpload() {
  const { lang } = useLang()
  const { isAdmin, role, user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('single')
  const [selectedFile, setSelectedFile] = useState(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [rawModelText, setRawModelText] = useState('')

  const [projects, setProjects] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [clients, setClients] = useState([])
  const [categories, setCategories] = useState([])
  const [vatRate, setVatRate] = useState(0.15)

  const [singleDraft, setSingleDraft] = useState(EMPTY_SINGLE)
  const [singlePartyMode, setSinglePartyMode] = useState('existing')
  const [singlePartyId, setSinglePartyId] = useState('')
  const [singleNewPartyNameAr, setSingleNewPartyNameAr] = useState('')
  const [singleNewPartyNameEn, setSingleNewPartyNameEn] = useState('')
  const [singleProjectId, setSingleProjectId] = useState('')
  const [singleCostCategoryId, setSingleCostCategoryId] = useState('')
  const [singleAllowDuplicate, setSingleAllowDuplicate] = useState(false)
  const [singleDuplicateWarning, setSingleDuplicateWarning] = useState('')
  const [singleSaving, setSingleSaving] = useState(false)
  const [singleResult, setSingleResult] = useState(null)

  const [statementDirection, setStatementDirection] = useState('supplier')
  const [statementPartyMode, setStatementPartyMode] = useState('existing')
  const [statementPartyId, setStatementPartyId] = useState('')
  const [statementNewPartyNameAr, setStatementNewPartyNameAr] = useState('')
  const [statementNewPartyNameEn, setStatementNewPartyNameEn] = useState('')
  const [statementProjectId, setStatementProjectId] = useState('')
  const [statementCostCategoryId, setStatementCostCategoryId] = useState('')
  const [statementRows, setStatementRows] = useState([])
  const [statementAllowDuplicate, setStatementAllowDuplicate] = useState(false)
  const [statementDuplicateWarning, setStatementDuplicateWarning] = useState('')
  const [statementSaving, setStatementSaving] = useState(false)
  const [statementResult, setStatementResult] = useState(null)

  useEffect(() => {
    let active = true

    const loadLookups = async () => {
      setLoading(true)
      setError('')
      try {
        const [projectsRes, suppliersRes, clientsRes, categoriesRes, settingsRes] = await Promise.all([
          supabase.from('projects').select('id,name_ar,name_en').order('name_en', { ascending: true }),
          supabase.from('suppliers').select('id,name_ar,name_en').order('name_en', { ascending: true }),
          supabase.from('clients').select('id,name_ar,name_en').order('name_en', { ascending: true }),
          supabase.from('cost_categories').select('id,name_ar,name_en').order('name_en', { ascending: true }),
          supabase.from('app_settings').select('key,value').eq('key', 'vat_rate').maybeSingle(),
        ])

        const errs = [projectsRes.error, suppliersRes.error, clientsRes.error, categoriesRes.error].filter(Boolean)
        if (errs.length) throw errs[0]
        if (!active) return

        setProjects(projectsRes.data || [])
        setSuppliers(suppliersRes.data || [])
        setClients(clientsRes.data || [])
        setCategories(categoriesRes.data || [])
        const nextVat = Number(settingsRes.data?.value)
        setVatRate(Number.isFinite(nextVat) && nextVat > 0 ? nextVat : 0.15)
      } catch (err) {
        if (!active) return
        setError(err?.message || (lang === 'ar' ? 'تعذر تحميل بيانات الربط' : 'Failed to load lookup data'))
      } finally {
        if (active) setLoading(false)
      }
    }

    loadLookups()
    return () => { active = false }
  }, [lang])

  const partyOptions = useMemo(() => {
    return (statementDirection === 'supplier' ? suppliers : clients).map((row) => ({
      value: row.id,
      label: lang === 'ar' ? (row.name_ar || row.name_en || row.id) : (row.name_en || row.name_ar || row.id),
    }))
  }, [statementDirection, suppliers, clients, lang])

  const singlePartyOptions = useMemo(() => {
    return (singleDraft.direction === 'supplier' ? suppliers : clients).map((row) => ({
      value: row.id,
      label: lang === 'ar' ? (row.name_ar || row.name_en || row.id) : (row.name_en || row.name_ar || row.id),
    }))
  }, [singleDraft.direction, suppliers, clients, lang])

  const projectOptions = useMemo(() => projects.map((row) => ({ value: row.id, label: formatProjectName(row, lang) })), [projects, lang])
  const categoryOptions = useMemo(() => categories.map((row) => ({ value: row.id, label: lang === 'ar' ? (row.name_ar || row.name_en || row.id) : (row.name_en || row.name_ar || row.id) })), [categories, lang])

  const money = useMemo(() => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }), [])

  const extractWithAnthropic = async () => {
    setError('')
    setRawModelText('')
    setSingleResult(null)
    setStatementResult(null)

    if (!selectedFile) {
      setError(lang === 'ar' ? 'اختر ملفًا أولًا.' : 'Please choose a file first.')
      return
    }

    if (!ALLOWED_FILE_TYPES.includes(selectedFile.type)) {
      setError(lang === 'ar' ? 'الملف يجب أن يكون PDF أو JPG أو PNG.' : 'File must be PDF, JPG, or PNG.')
      return
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError(lang === 'ar' ? 'الحد الأقصى 10MB.' : 'Maximum file size is 10MB.')
      return
    }

    setIsExtracting(true)
    try {
      const base64 = await fileToBase64(selectedFile)
      const { data, error: fnError } = await supabase.functions.invoke('smart-upload-extract', {
        body: {
          mode,
          lang,
          file: {
            name: selectedFile.name,
            type: selectedFile.type,
            size: selectedFile.size,
            base64,
          },
        },
      })

      if (fnError) throw fnError

      if (!data?.ok) {
        setRawModelText(String(data?.raw_text || ''))
        setError(data?.error || (lang === 'ar' ? 'تعذر تفسير الاستجابة كـ JSON.' : 'Could not parse model response as JSON.'))
        return
      }

      if (mode === 'single') {
        const parsed = data.parsed || {}
        const next = {
          direction: normalizeDirection(parsed.direction),
          invoice_no: String(parsed.invoice_no || ''),
          invoice_date: normalizeDate(parsed.invoice_date),
          due_date: normalizeDate(parsed.due_date),
          supplier_or_client_name: String(parsed.supplier_or_client_name || ''),
          amount_net: toAmountInput(parseAmount(parsed.amount_net)),
          vat_amount: toAmountInput(parseAmount(parsed.vat_amount)),
          amount_gross: toAmountInput(parseAmount(parsed.amount_gross)),
          currency: String(parsed.currency || 'SAR').toUpperCase(),
          confidence_notes: parsed.confidence_notes || {},
        }

        const net = parseAmount(next.amount_net)
        const vat = parseAmount(next.vat_amount)
        const gross = parseAmount(next.amount_gross)

        if (net > 0 && vat <= 0 && gross <= 0) {
          const autoVat = Number((net * vatRate).toFixed(2))
          next.vat_amount = toAmountInput(autoVat)
          next.amount_gross = toAmountInput(Number((net + autoVat).toFixed(2)))
        } else if (net > 0 && vat <= 0 && gross > 0) {
          next.vat_amount = toAmountInput(Number((gross - net).toFixed(2)))
        } else if (net > 0 && vat > 0 && gross <= 0) {
          next.amount_gross = toAmountInput(Number((net + vat).toFixed(2)))
        }

        setSingleDraft(next)
        setSinglePartyMode('existing')
        setSinglePartyId('')
        setSingleProjectId('')
        setSingleCostCategoryId('')
        setSingleAllowDuplicate(false)
        setSingleDuplicateWarning('')
      } else {
        const parsedRows = Array.isArray(data.parsed?.rows) ? data.parsed.rows : (Array.isArray(data.parsed) ? data.parsed : [])
        const normalized = parsedRows.map((row, idx) => {
          const draft = {
            ...EMPTY_STATEMENT_ROW,
            include: true,
            date: normalizeDate(row.date),
            description: String(row.description || ''),
            invoice_no: String(row.invoice_no || ''),
            debit: toAmountInput(parseAmount(row.debit)),
            credit: toAmountInput(parseAmount(row.credit)),
            running_balance: toAmountInput(parseAmount(row.running_balance || row.balance)),
            project_id: '',
          }
          draft.classification = inferClassification(draft)
          return { id: `${Date.now()}-${idx}`, ...draft }
        })

        setStatementRows(normalized)
        setStatementAllowDuplicate(false)
        setStatementDuplicateWarning('')
      }
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر تنفيذ الرفع الذكي.' : 'Smart upload failed.'))
    } finally {
      setIsExtracting(false)
    }
  }

  const resolveParty = async ({ direction, partyMode, partyId, nameAr, nameEn }) => {
    if (partyMode === 'existing') return partyId || null

    const payload = {
      name_ar: nameAr || null,
      name_en: nameEn || null,
    }

    if (!payload.name_ar && !payload.name_en) {
      throw new Error(lang === 'ar' ? 'أدخل اسم الجهة الجديدة.' : 'Enter a new party name.')
    }

    if (direction === 'supplier') {
      const { data, error: insertError } = await supabase.from('suppliers').insert(payload).select().single()
      if (insertError) throw insertError
      setSuppliers((prev) => [data, ...prev])
      await writeAuditLog({ tableName: 'suppliers', rowId: data.id, action: 'insert', before: null, after: data, user })
      return data.id
    }

    const { data, error: insertError } = await supabase.from('clients').insert(payload).select().single()
    if (insertError) throw insertError
    setClients((prev) => [data, ...prev])
    await writeAuditLog({ tableName: 'clients', rowId: data.id, action: 'insert', before: null, after: data, user })
    return data.id
  }

  const checkSingleDuplicate = async ({ direction, invoiceNo, projectId, partyId }) => {
    if (!invoiceNo) return false

    if (direction === 'supplier') {
      const { data, error: qError } = await supabase
        .from('supplier_invoices')
        .select('id,invoice_no')
        .is('deleted_at', null)
        .eq('supplier_id', partyId)
        .eq('project_id', projectId)
        .eq('invoice_no', invoiceNo)
      if (qError) throw qError
      return (data || []).length > 0
    }

    const withClient = await supabase
      .from('client_invoices')
      .select('id,invoice_no')
      .is('deleted_at', null)
      .eq('project_id', projectId)
      .eq('invoice_no', invoiceNo)
      .eq('client_id', partyId)

    if (!withClient.error) return (withClient.data || []).length > 0

    const fallback = await supabase
      .from('client_invoices')
      .select('id,invoice_no')
      .is('deleted_at', null)
      .eq('project_id', projectId)
      .eq('invoice_no', invoiceNo)

    if (fallback.error) throw fallback.error
    return (fallback.data || []).length > 0
  }

  const saveSingle = async () => {
    if (!isAdmin) return
    setSingleSaving(true)
    setError('')
    setSingleResult(null)

    try {
      if (!singleProjectId) throw new Error(lang === 'ar' ? 'اختر المشروع.' : 'Select a project.')
      if (singleDraft.direction === 'supplier' && !singleCostCategoryId) {
        throw new Error(lang === 'ar' ? 'اختر فئة التكلفة.' : 'Select cost category.')
      }

      const partyId = await resolveParty({
        direction: singleDraft.direction,
        partyMode: singlePartyMode,
        partyId: singlePartyId,
        nameAr: singleNewPartyNameAr,
        nameEn: singleNewPartyNameEn,
      })

      if (!partyId) throw new Error(lang === 'ar' ? 'اختر جهة الفاتورة.' : 'Select invoice party.')

      const hasDuplicate = await checkSingleDuplicate({
        direction: singleDraft.direction,
        invoiceNo: singleDraft.invoice_no,
        projectId: singleProjectId,
        partyId,
      })

      if (hasDuplicate && !singleAllowDuplicate) {
        setSingleDuplicateWarning(lang === 'ar' ? 'تحذير: رقم الفاتورة موجود مسبقًا لنفس الجهة والمشروع.' : 'Warning: invoice number already exists for the same party and project.')
        setSingleSaving(false)
        return
      }

      const net = parseAmount(singleDraft.amount_net)
      const vat = parseAmount(singleDraft.vat_amount)
      const gross = parseAmount(singleDraft.amount_gross)

      if (singleDraft.direction === 'supplier') {
        const payload = {
          supplier_id: partyId,
          project_id: singleProjectId,
          cost_category_id: singleCostCategoryId || null,
          invoice_no: singleDraft.invoice_no || null,
          invoice_date: normalizeDate(singleDraft.invoice_date) || null,
          due_date: normalizeDate(singleDraft.due_date) || null,
          amount_net: net,
          vat_amount: vat,
          amount_gross: gross,
          status: 'received',
          has_valid_tax_invoice: true,
        }

        const { data, error: insertError } = await supabase.from('supplier_invoices').insert(payload).select().single()
        if (insertError) throw insertError

        await writeAuditLog({ tableName: 'supplier_invoices', rowId: data.id, action: 'insert', before: null, after: data, user })
        setSingleResult({ table: 'supplier_invoices', id: data.id })
      } else {
        const basePayload = {
          project_id: singleProjectId,
          invoice_no: singleDraft.invoice_no || null,
          invoice_date: normalizeDate(singleDraft.invoice_date) || null,
          due_date: normalizeDate(singleDraft.due_date) || null,
          amount_net: net,
          vat_amount: vat,
          amount_gross: gross,
          retention_amount: 0,
          status: 'submitted',
          client_id: partyId,
        }

        let inserted
        const withClientInsert = await supabase.from('client_invoices').insert(basePayload).select().single()
        if (withClientInsert.error) {
          const fallbackPayload = { ...basePayload }
          delete fallbackPayload.client_id
          const fallbackInsert = await supabase.from('client_invoices').insert(fallbackPayload).select().single()
          if (fallbackInsert.error) throw fallbackInsert.error
          inserted = fallbackInsert.data
        } else {
          inserted = withClientInsert.data
        }

        await writeAuditLog({ tableName: 'client_invoices', rowId: inserted.id, action: 'insert', before: null, after: inserted, user })
        setSingleResult({ table: 'client_invoices', id: inserted.id })
      }

      window.dispatchEvent(new Event('intiqal:data-changed'))
      setSingleDuplicateWarning('')
      setSingleAllowDuplicate(false)
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر حفظ الفاتورة.' : 'Failed to save invoice.'))
    } finally {
      setSingleSaving(false)
    }
  }

  const updateStatementRow = (id, key, value) => {
    setStatementRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)))
  }

  const checkedStatementRows = useMemo(() => statementRows.filter((row) => row.include), [statementRows])

  const statementTotals = useMemo(() => {
    return checkedStatementRows.reduce((acc, row) => {
      acc.debit += parseAmount(row.debit)
      acc.credit += parseAmount(row.credit)
      return acc
    }, { debit: 0, credit: 0 })
  }, [checkedStatementRows])

  const checkStatementDuplicates = async ({ direction, rows, projectFallback, partyId }) => {
    const invoiceNos = rows
      .filter((row) => row.classification === 'invoice')
      .map((row) => String(row.invoice_no || '').trim())
      .filter(Boolean)

    if (!invoiceNos.length) return 0

    if (direction === 'supplier') {
      const { data, error: qError } = await supabase
        .from('supplier_invoices')
        .select('id,invoice_no,project_id,supplier_id')
        .is('deleted_at', null)
        .eq('supplier_id', partyId)
        .in('invoice_no', invoiceNos)
      if (qError) throw qError

      const rowSet = new Set(rows.map((row) => `${String(row.invoice_no || '').trim()}::${row.project_id || projectFallback}`))
      return (data || []).filter((row) => rowSet.has(`${String(row.invoice_no || '').trim()}::${row.project_id || projectFallback}`)).length
    }

    const fallback = await supabase
      .from('client_invoices')
      .select('id,invoice_no,project_id')
      .is('deleted_at', null)
      .in('invoice_no', invoiceNos)

    if (fallback.error) throw fallback.error

    const rowSet = new Set(rows.map((row) => `${String(row.invoice_no || '').trim()}::${row.project_id || projectFallback}`))
    return (fallback.data || []).filter((row) => rowSet.has(`${String(row.invoice_no || '').trim()}::${row.project_id || projectFallback}`)).length
  }

  const saveStatement = async () => {
    if (!isAdmin) return
    if (!checkedStatementRows.length) {
      setError(lang === 'ar' ? 'اختر صفًا واحدًا على الأقل.' : 'Select at least one row.')
      return
    }

    setStatementSaving(true)
    setError('')
    setStatementResult(null)

    try {
      const partyId = await resolveParty({
        direction: statementDirection,
        partyMode: statementPartyMode,
        partyId: statementPartyId,
        nameAr: statementNewPartyNameAr,
        nameEn: statementNewPartyNameEn,
      })
      if (!partyId) throw new Error(lang === 'ar' ? 'اختر الجهة أولًا.' : 'Select party first.')

      const dupCount = await checkStatementDuplicates({
        direction: statementDirection,
        rows: checkedStatementRows,
        projectFallback: statementProjectId,
        partyId,
      })

      if (dupCount > 0 && !statementAllowDuplicate) {
        setStatementDuplicateWarning(
          lang === 'ar'
            ? `تحذير: يوجد ${dupCount} رقم فاتورة مكرر في الدفعة.`
            : `Warning: ${dupCount} duplicate invoice number(s) found in this batch.`,
        )
        setStatementSaving(false)
        return
      }

      let inserted = 0

      for (const row of checkedStatementRows) {
        const projectId = row.project_id || statementProjectId || null
        const invoiceNo = String(row.invoice_no || '').trim() || null
        const date = normalizeDate(row.date) || null

        if (statementDirection === 'supplier') {
          if (row.classification === 'invoice') {
            const net = parseAmount(row.debit) > 0 ? parseAmount(row.debit) : parseAmount(row.credit)
            const vat = Number((net * vatRate).toFixed(2))
            const gross = Number((net + vat).toFixed(2))
            const payload = {
              supplier_id: partyId,
              project_id: projectId,
              cost_category_id: statementCostCategoryId || null,
              invoice_no: invoiceNo,
              invoice_date: date,
              due_date: date,
              amount_net: net,
              vat_amount: vat,
              amount_gross: gross,
              status: 'received',
              has_valid_tax_invoice: true,
            }
            const { data, error: insertError } = await supabase.from('supplier_invoices').insert(payload).select().single()
            if (insertError) throw insertError
            inserted += 1
            await writeAuditLog({ tableName: 'supplier_invoices', rowId: data.id, action: 'insert', before: null, after: data, user })
          } else {
            const amount = parseAmount(row.credit) > 0 ? parseAmount(row.credit) : parseAmount(row.debit)
            const payload = {
              supplier_invoice_id: null,
              payment_date: date,
              amount,
            }
            const { data, error: insertError } = await supabase.from('supplier_payments').insert(payload).select().single()
            if (insertError) throw insertError
            inserted += 1
            await writeAuditLog({ tableName: 'supplier_payments', rowId: data.id, action: 'insert', before: null, after: data, user })
          }
        } else {
          if (row.classification === 'invoice') {
            const net = parseAmount(row.debit) > 0 ? parseAmount(row.debit) : parseAmount(row.credit)
            const vat = Number((net * vatRate).toFixed(2))
            const gross = Number((net + vat).toFixed(2))
            const payload = {
              project_id: projectId,
              invoice_no: invoiceNo,
              invoice_date: date,
              due_date: date,
              amount_net: net,
              vat_amount: vat,
              amount_gross: gross,
              retention_amount: 0,
              status: 'submitted',
              client_id: partyId,
            }

            let insertedRow
            const tryInsert = await supabase.from('client_invoices').insert(payload).select().single()
            if (tryInsert.error) {
              const fallback = { ...payload }
              delete fallback.client_id
              const fallbackInsert = await supabase.from('client_invoices').insert(fallback).select().single()
              if (fallbackInsert.error) throw fallbackInsert.error
              insertedRow = fallbackInsert.data
            } else {
              insertedRow = tryInsert.data
            }

            inserted += 1
            await writeAuditLog({ tableName: 'client_invoices', rowId: insertedRow.id, action: 'insert', before: null, after: insertedRow, user })
          } else {
            const amount = parseAmount(row.credit) > 0 ? parseAmount(row.credit) : parseAmount(row.debit)
            const payload = {
              project_id: projectId,
              client_invoice_id: null,
              payment_date: date,
              amount,
              method: 'bank_transfer',
            }
            const { data, error: insertError } = await supabase.from('client_payments').insert(payload).select().single()
            if (insertError) throw insertError
            inserted += 1
            await writeAuditLog({ tableName: 'client_payments', rowId: data.id, action: 'insert', before: null, after: data, user })
          }
        }
      }

      setStatementResult({ inserted })
      setStatementDuplicateWarning('')
      setStatementAllowDuplicate(false)
      window.dispatchEvent(new Event('intiqal:data-changed'))
    } catch (err) {
      setError(err?.message || (lang === 'ar' ? 'تعذر حفظ دفعة كشف الحساب.' : 'Failed to save statement batch.'))
    } finally {
      setStatementSaving(false)
    }
  }

  const disabledSaveSingle = !isAdmin || singleSaving || isExtracting
  const disabledSaveStatement = !isAdmin || statementSaving || isExtracting

  if (!isAdmin) {
    return (
      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'الرفع الذكي' : 'Smart Upload'}</div>
        <div className="tag-note" style={{ color: 'var(--amber)', background: 'var(--amber-dim)' }}>
          {lang === 'ar' ? `هذه الصفحة للمسؤول فقط. دورك الحالي: ${role}` : `This page is admin-only. Current role: ${role}`}
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="card"><div className="card-label">{lang === 'ar' ? 'تحميل الرفع الذكي...' : 'Loading smart upload...'}</div></div>
  }

  return (
    <div>
      <h1 className="display">{lang === 'ar' ? 'Smart Upload (Claude)' : 'Smart Upload (Claude)'}</h1>
      <p className="card-sub" style={{ maxWidth: 820 }}>
        {lang === 'ar'
          ? 'الاستخراج يملأ نموذج المراجعة فقط. لا يتم الحفظ في قاعدة البيانات إلا بعد الضغط على Confirm.'
          : 'Extraction only fills the review UI. Nothing is written to the database until you click Confirm.'}
      </p>

      {error ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>{error}</div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 14 }}>
        <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'الملف والإستخراج' : 'File + Extraction'}</div>
        <div className="form-grid">
          <div>
            <div className="card-label">{lang === 'ar' ? 'الوضع' : 'Mode'}</div>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {modeOptions(lang).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          <div>
            <div className="card-label">{lang === 'ar' ? 'الملف' : 'File'}</div>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            />
          </div>
        </div>

        <div className="employee-actions" style={{ marginTop: 10 }}>
          <button className="btn" type="button" onClick={extractWithAnthropic} disabled={isExtracting}>
            {isExtracting
              ? (lang === 'ar' ? 'Claude يقرأ الملف...' : 'Claude is reading...')
              : (lang === 'ar' ? 'Extract + Review' : 'Extract + Review')}
          </button>
          {selectedFile ? <span className="card-sub">{selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)</span> : null}
        </div>

        {rawModelText ? (
          <div style={{ marginTop: 12 }}>
            <div className="card-label">{lang === 'ar' ? 'الاستجابة الخام (JSON غير صالح)' : 'Raw model output (invalid JSON)'}</div>
            <textarea value={rawModelText} onChange={(e) => setRawModelText(e.target.value)} />
          </div>
        ) : null}
      </div>

      {mode === 'single' ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'مراجعة فاتورة واحدة' : 'Single Invoice Review'}</div>

          <div className="form-grid">
            <div>
              <div className="card-label">Direction</div>
              <select value={singleDraft.direction} onChange={(e) => setSingleDraft((prev) => ({ ...prev, direction: e.target.value }))}>
                <option value="supplier">{lang === 'ar' ? 'فاتورة مورد علينا' : 'Supplier invoice TO us'}</option>
                <option value="client">{lang === 'ar' ? 'فاتورة عميل منا' : 'Client invoice FROM us'}</option>
              </select>
            </div>
            <div>
              <div className="card-label">Currency</div>
              <input value={singleDraft.currency} onChange={(e) => setSingleDraft((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))} />
            </div>
          </div>

          <div className="form-grid">
            <div>
              <div className="card-label">Invoice No</div>
              <input value={singleDraft.invoice_no} onChange={(e) => setSingleDraft((prev) => ({ ...prev, invoice_no: e.target.value }))} />
              <div className="card-sub">{singleDraft.confidence_notes?.invoice_no || ''}</div>
            </div>
            <div>
              <div className="card-label">Party Name</div>
              <input value={singleDraft.supplier_or_client_name} onChange={(e) => setSingleDraft((prev) => ({ ...prev, supplier_or_client_name: e.target.value }))} />
              <div className="card-sub">{singleDraft.confidence_notes?.supplier_or_client_name || ''}</div>
            </div>
          </div>

          <div className="form-grid">
            <div>
              <div className="card-label">Invoice Date</div>
              <input type="date" value={singleDraft.invoice_date} onChange={(e) => setSingleDraft((prev) => ({ ...prev, invoice_date: e.target.value }))} />
              <div className="card-sub">{singleDraft.confidence_notes?.invoice_date || ''}</div>
            </div>
            <div>
              <div className="card-label">Due Date</div>
              <input type="date" value={singleDraft.due_date} onChange={(e) => setSingleDraft((prev) => ({ ...prev, due_date: e.target.value }))} />
              <div className="card-sub">{singleDraft.confidence_notes?.due_date || ''}</div>
            </div>
          </div>

          <div className="form-grid">
            <div>
              <div className="card-label">Amount Net</div>
              <input
                value={singleDraft.amount_net}
                onChange={(e) => {
                  const value = e.target.value
                  setSingleDraft((prev) => {
                    const net = parseAmount(value)
                    if (!value) return { ...prev, amount_net: value }
                    const shouldAutoVat = !prev.vat_amount || parseAmount(prev.vat_amount) <= 0
                    const shouldAutoGross = !prev.amount_gross || parseAmount(prev.amount_gross) <= 0
                    return {
                      ...prev,
                      amount_net: value,
                      vat_amount: shouldAutoVat ? toAmountInput(Number((net * vatRate).toFixed(2))) : prev.vat_amount,
                      amount_gross: shouldAutoGross ? toAmountInput(Number((net * (1 + vatRate)).toFixed(2))) : prev.amount_gross,
                    }
                  })
                }}
              />
              <div className="card-sub">{singleDraft.confidence_notes?.amount_net || ''}</div>
            </div>
            <div>
              <div className="card-label">VAT Amount</div>
              <input value={singleDraft.vat_amount} onChange={(e) => setSingleDraft((prev) => ({ ...prev, vat_amount: e.target.value }))} />
              <div className="card-sub">{singleDraft.confidence_notes?.vat_amount || ''}</div>
            </div>
          </div>

          <div className="form-grid">
            <div>
              <div className="card-label">Amount Gross</div>
              <input value={singleDraft.amount_gross} onChange={(e) => setSingleDraft((prev) => ({ ...prev, amount_gross: e.target.value }))} />
              <div className="card-sub">{singleDraft.confidence_notes?.amount_gross || ''}</div>
            </div>
            <div>
              <div className="card-label">{lang === 'ar' ? 'المشروع' : 'Project'}</div>
              <select value={singleProjectId} onChange={(e) => setSingleProjectId(e.target.value)}>
                <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
                {projectOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div>
              <div className="card-label">{lang === 'ar' ? 'ربط الجهة' : 'Party mapping'}</div>
              <select value={singlePartyMode} onChange={(e) => setSinglePartyMode(e.target.value)}>
                <option value="existing">{lang === 'ar' ? 'اختيار جهة موجودة' : 'Pick existing party'}</option>
                <option value="new">{lang === 'ar' ? 'إنشاء جهة جديدة' : 'Create new party'}</option>
              </select>
            </div>
            <div>
              <div className="card-label">{lang === 'ar' ? 'فئة التكلفة (للمورد)' : 'Cost category (supplier only)'}</div>
              <select value={singleCostCategoryId} onChange={(e) => setSingleCostCategoryId(e.target.value)} disabled={singleDraft.direction !== 'supplier'}>
                <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
                {categoryOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          </div>

          {singlePartyMode === 'existing' ? (
            <div>
              <div className="card-label">{lang === 'ar' ? 'الجهة' : 'Party'}</div>
              <select value={singlePartyId} onChange={(e) => setSinglePartyId(e.target.value)}>
                <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
                {singlePartyOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          ) : (
            <div className="form-grid">
              <div>
                <div className="card-label">{lang === 'ar' ? 'اسم عربي' : 'Arabic name'}</div>
                <input value={singleNewPartyNameAr} onChange={(e) => setSingleNewPartyNameAr(e.target.value)} />
              </div>
              <div>
                <div className="card-label">{lang === 'ar' ? 'اسم إنجليزي' : 'English name'}</div>
                <input value={singleNewPartyNameEn} onChange={(e) => setSingleNewPartyNameEn(e.target.value)} />
              </div>
            </div>
          )}

          {singleDuplicateWarning ? (
            <div className="tag-note" style={{ marginTop: 10, color: 'var(--amber)', background: 'var(--amber-dim)' }}>{singleDuplicateWarning}</div>
          ) : null}

          <div className="employee-actions" style={{ marginTop: 10 }}>
            <label className="card-sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={singleAllowDuplicate} onChange={(e) => setSingleAllowDuplicate(e.target.checked)} />
              {lang === 'ar' ? 'السماح بالحفظ رغم التكرار' : 'Allow save despite duplicates'}
            </label>
          </div>

          <div className="employee-actions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={saveSingle} disabled={disabledSaveSingle}>
              {singleSaving
                ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                : (lang === 'ar' ? 'Confirm + Save Invoice' : 'Confirm + Save Invoice')}
            </button>
            {singleResult ? (
              <a className="btn secondary" href="#/admin">{lang === 'ar' ? `تم الحفظ: ${singleResult.table}/${singleResult.id}` : `Saved: ${singleResult.table}/${singleResult.id}`}</a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>{lang === 'ar' ? 'مراجعة كشف الحساب' : 'Account Statement Review'}</div>

          <div className="form-grid">
            <div>
              <div className="card-label">{lang === 'ar' ? 'نوع الجهة' : 'Party type'}</div>
              <select value={statementDirection} onChange={(e) => setStatementDirection(e.target.value)}>
                <option value="supplier">{lang === 'ar' ? 'مورد' : 'Supplier'}</option>
                <option value="client">{lang === 'ar' ? 'عميل' : 'Client'}</option>
              </select>
            </div>
            <div>
              <div className="card-label">{lang === 'ar' ? 'وضع الجهة' : 'Party mode'}</div>
              <select value={statementPartyMode} onChange={(e) => setStatementPartyMode(e.target.value)}>
                <option value="existing">{lang === 'ar' ? 'اختيار جهة موجودة' : 'Pick existing party'}</option>
                <option value="new">{lang === 'ar' ? 'إنشاء جهة جديدة' : 'Create new party'}</option>
              </select>
            </div>
          </div>

          {statementPartyMode === 'existing' ? (
            <div className="form-grid">
              <div>
                <div className="card-label">{lang === 'ar' ? 'الجهة' : 'Party'}</div>
                <select value={statementPartyId} onChange={(e) => setStatementPartyId(e.target.value)}>
                  <option value="">{lang === 'ar' ? 'اختر' : 'Select'}</option>
                  {partyOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              <div>
                <div className="card-label">{lang === 'ar' ? 'المشروع الافتراضي' : 'Default project'}</div>
                <select value={statementProjectId} onChange={(e) => {
                  const value = e.target.value
                  setStatementProjectId(value)
                  setStatementRows((prev) => prev.map((row) => ({ ...row, project_id: row.project_id || value })))
                }}>
                  <option value="">{lang === 'ar' ? 'بدون' : 'None'}</option>
                  {projectOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div className="form-grid">
              <div>
                <div className="card-label">{lang === 'ar' ? 'اسم عربي' : 'Arabic name'}</div>
                <input value={statementNewPartyNameAr} onChange={(e) => setStatementNewPartyNameAr(e.target.value)} />
              </div>
              <div>
                <div className="card-label">{lang === 'ar' ? 'اسم إنجليزي' : 'English name'}</div>
                <input value={statementNewPartyNameEn} onChange={(e) => setStatementNewPartyNameEn(e.target.value)} />
              </div>
            </div>
          )}

          {statementDirection === 'supplier' ? (
            <div style={{ marginTop: 10 }}>
              <div className="card-label">{lang === 'ar' ? 'فئة تكلفة افتراضية (اختياري)' : 'Default cost category (optional)'}</div>
              <select value={statementCostCategoryId} onChange={(e) => setStatementCostCategoryId(e.target.value)}>
                <option value="">{lang === 'ar' ? 'بدون' : 'None'}</option>
                {categoryOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          ) : null}

          <div className="info-row" style={{ marginTop: 12 }}>
            <span>{lang === 'ar' ? 'عدد الصفوف المختارة' : 'Included rows'}</span>
            <span className="mono">{checkedStatementRows.length}</span>
          </div>
          <div className="info-row">
            <span>{lang === 'ar' ? 'إجمالي المدين' : 'Total debit'}</span>
            <span className="mono">{money.format(statementTotals.debit)} SAR</span>
          </div>
          <div className="info-row">
            <span>{lang === 'ar' ? 'إجمالي الدائن' : 'Total credit'}</span>
            <span className="mono">{money.format(statementTotals.credit)} SAR</span>
          </div>

          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{lang === 'ar' ? 'تضمين' : 'Include'}</th>
                  <th>{lang === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th>{lang === 'ar' ? 'الوصف' : 'Description'}</th>
                  <th>{lang === 'ar' ? 'رقم فاتورة' : 'Invoice No'}</th>
                  <th>{lang === 'ar' ? 'مدين' : 'Debit'}</th>
                  <th>{lang === 'ar' ? 'دائن' : 'Credit'}</th>
                  <th>{lang === 'ar' ? 'الرصيد' : 'Balance'}</th>
                  <th>{lang === 'ar' ? 'التصنيف' : 'Class'}</th>
                  <th>{lang === 'ar' ? 'المشروع' : 'Project'}</th>
                </tr>
              </thead>
              <tbody>
                {statementRows.length ? statementRows.map((row) => (
                  <tr key={row.id}>
                    <td><input type="checkbox" checked={row.include} onChange={(e) => updateStatementRow(row.id, 'include', e.target.checked)} /></td>
                    <td><input type="date" value={row.date} onChange={(e) => updateStatementRow(row.id, 'date', e.target.value)} /></td>
                    <td><input value={row.description} onChange={(e) => updateStatementRow(row.id, 'description', e.target.value)} /></td>
                    <td><input value={row.invoice_no} onChange={(e) => updateStatementRow(row.id, 'invoice_no', e.target.value)} /></td>
                    <td><input value={row.debit} onChange={(e) => updateStatementRow(row.id, 'debit', e.target.value)} /></td>
                    <td><input value={row.credit} onChange={(e) => updateStatementRow(row.id, 'credit', e.target.value)} /></td>
                    <td><input value={row.running_balance} onChange={(e) => updateStatementRow(row.id, 'running_balance', e.target.value)} /></td>
                    <td>
                      <select value={row.classification} onChange={(e) => updateStatementRow(row.id, 'classification', e.target.value)}>
                        <option value="invoice">{lang === 'ar' ? 'فاتورة' : 'Invoice'}</option>
                        <option value="payment">{lang === 'ar' ? 'دفعة' : 'Payment'}</option>
                      </select>
                    </td>
                    <td>
                      <select value={row.project_id} onChange={(e) => updateStatementRow(row.id, 'project_id', e.target.value)}>
                        <option value="">{lang === 'ar' ? 'بدون' : 'None'}</option>
                        {projectOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={9} className="card-sub">{lang === 'ar' ? 'ارفع كشف حساب ثم اضغط Extract + Review.' : 'Upload a statement and click Extract + Review first.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {statementDuplicateWarning ? (
            <div className="tag-note" style={{ marginTop: 10, color: 'var(--amber)', background: 'var(--amber-dim)' }}>{statementDuplicateWarning}</div>
          ) : null}

          <div className="employee-actions" style={{ marginTop: 10 }}>
            <label className="card-sub" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={statementAllowDuplicate} onChange={(e) => setStatementAllowDuplicate(e.target.checked)} />
              {lang === 'ar' ? 'السماح بالحفظ رغم التكرار' : 'Allow save despite duplicates'}
            </label>
          </div>

          <div className="employee-actions" style={{ marginTop: 12 }}>
            <button className="btn" type="button" onClick={saveStatement} disabled={disabledSaveStatement}>
              {statementSaving
                ? (lang === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                : (lang === 'ar' ? 'Confirm + Import Selected Rows' : 'Confirm + Import Selected Rows')}
            </button>
            {statementResult ? <span className="tag-note">{lang === 'ar' ? `تم إدراج ${statementResult.inserted} صف` : `${statementResult.inserted} rows inserted`}</span> : null}
          </div>
        </div>
      )}
    </div>
  )
}
