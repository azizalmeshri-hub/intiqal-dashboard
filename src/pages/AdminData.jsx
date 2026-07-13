import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { writeAuditLog } from '../lib/auditLog'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import EditableTable from '../components/EditableTable'
import RecordFormModal from '../components/RecordFormModal'

const DEBOUNCE_MS = 800

function toNumberOrNull(value) {
  if (value === '' || value == null) return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num
}

function isPermissionError(error) {
  const msg = String(error?.message || '').toLowerCase()
  return msg.includes('permission') || msg.includes('row-level security') || msg.includes('rls') || msg.includes('42501')
}

function normalizePayload(rawValues, columns) {
  const payload = {}
  columns.forEach((col) => {
    if (rawValues[col.key] === undefined) return
    const raw = rawValues[col.key]
    if (col.type === 'number') payload[col.key] = raw === '' ? null : Number(raw)
    else payload[col.key] = raw === '' ? null : raw
  })
  return payload
}

function useAdminTable({
  tableName,
  select,
  columns,
  canEdit,
  user,
  softDelete,
  validateRow,
  onDataChanged,
  buildPatch,
  defaultAddValues,
}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [globalError, setGlobalError] = useState('')
  const [statusByCell, setStatusByCell] = useState({})
  const [rowWarnings, setRowWarnings] = useState({})
  const [rowErrors, setRowErrors] = useState({})

  const rowsRef = useRef([])
  const pendingRef = useRef({})
  const beforeRef = useRef({})
  const timerRef = useRef({})

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  const loadRows = useCallback(async () => {
    setLoading(true)
    setGlobalError('')
    try {
      let query = supabase.from(tableName).select(select)
      if (softDelete) query = query.is('deleted_at', null)
      const { data, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      setRows(data || [])
    } catch (error) {
      setGlobalError(error?.message || 'Failed to fetch table rows')
    } finally {
      setLoading(false)
    }
  }, [tableName, select, softDelete])

  useEffect(() => { loadRows() }, [loadRows])

  const applyValidation = (row, allRows) => {
    if (!validateRow) return { error: '', warning: '' }
    return validateRow(row, allRows) || { error: '', warning: '' }
  }

  const flushField = useCallback(async (rowId, field) => {
    const rowPatch = pendingRef.current[rowId]
    if (!rowPatch || rowPatch[field] === undefined) return

    const patch = { [field]: rowPatch[field] }
    const currentRows = rowsRef.current
    const before = beforeRef.current[rowId]
    const nextRow = currentRows.find((r) => r.id === rowId)
    const validation = applyValidation(nextRow, currentRows)

    if (validation.error) {
      setRowErrors((prev) => ({ ...prev, [rowId]: validation.error }))
      setStatusByCell((prev) => ({ ...prev, [`${rowId}:${field}`]: 'retry' }))
      return
    }

    if (validation.warning) {
      setRowWarnings((prev) => ({ ...prev, [rowId]: validation.warning }))
    } else {
      setRowWarnings((prev) => {
        const next = { ...prev }
        delete next[rowId]
        return next
      })
    }

    try {
      if (!canEdit) throw new Error("You don't have permission to edit")

      const { error } = await supabase.from(tableName).update(patch).eq('id', rowId)
      if (error) throw error

      setStatusByCell((prev) => ({ ...prev, [`${rowId}:${field}`]: 'saved' }))
      setTimeout(() => {
        setStatusByCell((prev) => {
          const next = { ...prev }
          delete next[`${rowId}:${field}`]
          return next
        })
      }, 1500)

      setRowErrors((prev) => {
        const next = { ...prev }
        delete next[rowId]
        return next
      })

      onDataChanged?.()

      const after = { ...(nextRow || {}), ...patch }
      writeAuditLog({
        tableName,
        rowId,
        action: 'update',
        before,
        after,
        user,
      })
    } catch (error) {
      const friendly = isPermissionError(error)
        ? "You don't have permission to edit"
        : (error?.message || 'Update failed')
      setGlobalError(friendly)
      setStatusByCell((prev) => ({ ...prev, [`${rowId}:${field}`]: 'retry' }))
    } finally {
      if (pendingRef.current[rowId]) {
        delete pendingRef.current[rowId][field]
        if (Object.keys(pendingRef.current[rowId]).length === 0) {
          delete pendingRef.current[rowId]
          delete beforeRef.current[rowId]
        }
      }
    }
  }, [tableName, canEdit, user])

  const onChangeCell = (rowId, field, rawValue) => {
    const currentRows = rowsRef.current
    const currentRow = currentRows.find((r) => r.id === rowId)
    if (!currentRow) return

    const computedPatch = buildPatch
      ? buildPatch({ row: currentRow, field, rawValue, rows: currentRows })
      : { [field]: rawValue }

    const nextRows = currentRows.map((row) => row.id === rowId ? { ...row, ...computedPatch } : row)
    setRows(nextRows)

    if (!beforeRef.current[rowId]) beforeRef.current[rowId] = currentRow
    pendingRef.current[rowId] = { ...(pendingRef.current[rowId] || {}), ...computedPatch }

    Object.keys(computedPatch).forEach((patchField) => {
      const key = `${rowId}:${patchField}`
      setStatusByCell((prev) => ({ ...prev, [key]: 'saving' }))

      if (timerRef.current[key]) clearTimeout(timerRef.current[key])
      timerRef.current[key] = setTimeout(() => {
        flushField(rowId, patchField)
      }, DEBOUNCE_MS)
    })
  }

  const addRow = async (rawValues) => {
    const payload = { ...defaultAddValues, ...normalizePayload(rawValues, columns) }
    const validation = applyValidation(payload, rows)
    if (validation.error) {
      throw new Error(validation.error)
    }

    if (!canEdit) throw new Error("You don't have permission to edit")

    const { data, error } = await supabase.from(tableName).insert(payload).select().single()
    if (error) {
      if (isPermissionError(error)) throw new Error("You don't have permission to edit")
      throw error
    }

    setRows((prev) => [data, ...prev])
    onDataChanged?.()

    writeAuditLog({
      tableName,
      rowId: data.id,
      action: 'insert',
      before: null,
      after: data,
      user,
    })
  }

  const deleteRow = async (row) => {
    if (!canEdit) {
      setGlobalError("You don't have permission to edit")
      return
    }

    const before = row

    try {
      if (softDelete) {
        const { error } = await supabase
          .from(tableName)
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', row.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from(tableName).delete().eq('id', row.id)
        if (error) throw error
      }

      setRows((prev) => prev.filter((r) => r.id !== row.id))
      onDataChanged?.()

      writeAuditLog({
        tableName,
        rowId: row.id,
        action: 'delete',
        before,
        after: softDelete ? { ...row, deleted_at: new Date().toISOString() } : null,
        user,
      })
    } catch (error) {
      const friendly = isPermissionError(error)
        ? "You don't have permission to edit"
        : (error?.message || 'Delete failed')
      setGlobalError(friendly)
    }
  }

  return {
    rows,
    loading,
    globalError,
    statusByCell,
    rowWarnings,
    rowErrors,
    onChangeCell,
    addRow,
    deleteRow,
    reload: loadRows,
  }
}

function statusOptions(lang) {
  return [
    { value: 'planning', label: lang === 'ar' ? 'تخطيط' : 'Planning' },
    { value: 'active', label: lang === 'ar' ? 'نشط' : 'Active' },
    { value: 'on_hold', label: lang === 'ar' ? 'متوقف' : 'On Hold' },
    { value: 'completed', label: lang === 'ar' ? 'مكتمل' : 'Completed' },
    { value: 'closed', label: lang === 'ar' ? 'مغلق' : 'Closed' },
  ]
}

export default function AdminData() {
  const { lang } = useLang()
  const { isAdmin, role, user, refreshRole, refreshingRole } = useAuth()
  const [openModal, setOpenModal] = useState('')
  const [roleRefreshError, setRoleRefreshError] = useState('')

  const onDataChanged = () => {
    window.dispatchEvent(new Event('intiqal:data-changed'))
  }

  const projectColumns = useMemo(() => [
    { key: 'name_ar', label: 'Name (AR)', labelAr: 'الاسم (ع)' },
    { key: 'name_en', label: 'Name (EN)', labelAr: 'الاسم (EN)' },
    { key: 'status', label: 'Status', labelAr: 'الحالة', type: 'select', options: statusOptions(lang) },
    { key: 'contract_value_net', label: 'Contract Net', labelAr: 'قيمة العقد (صافي)', type: 'number' },
    { key: 'physical_pct', label: 'Physical %', labelAr: 'نسبة الإنجاز', type: 'number' },
    { key: 'advance_pct', label: 'Advance %', labelAr: 'الدفعة المقدمة %', type: 'number' },
    { key: 'retention_pct', label: 'Retention %', labelAr: 'الاستقطاع %', type: 'number' },
    { key: 'start_date', label: 'Start Date', labelAr: 'تاريخ البداية', type: 'date' },
    { key: 'planned_end_date', label: 'Planned End', labelAr: 'النهاية المخططة', type: 'date' },
    { key: 'actual_end_date', label: 'Actual End', labelAr: 'النهاية الفعلية', type: 'date' },
  ], [lang])

  const projectsTable = useAdminTable({
    tableName: 'projects',
    select: 'id,name_ar,name_en,status,contract_value_net,physical_pct,advance_pct,retention_pct,start_date,planned_end_date,actual_end_date,vat_rate,created_at',
    columns: projectColumns,
    canEdit: isAdmin,
    user,
    softDelete: false,
    onDataChanged,
    validateRow: (row) => {
      const numericKeys = ['contract_value_net', 'physical_pct', 'advance_pct', 'retention_pct']
      for (const key of numericKeys) {
        const v = toNumberOrNull(row[key])
        if (v != null && v < 0) return { error: lang === 'ar' ? 'القيم العددية يجب أن تكون 0 أو أكثر' : 'Numeric values must be >= 0' }
      }
      return { error: '', warning: '' }
    },
    defaultAddValues: { status: 'active', contract_value_net: 0, physical_pct: 0, advance_pct: 0, retention_pct: 0 },
  })

  const clientsColumns = useMemo(() => [
    { key: 'name_ar', label: 'Name (AR)', labelAr: 'اسم العميل (ع)' },
    { key: 'name_en', label: 'Name (EN)', labelAr: 'اسم العميل (EN)' },
    { key: 'contact_name', label: 'Contact', labelAr: 'اسم جهة الاتصال' },
    { key: 'contact_phone', label: 'Phone', labelAr: 'الهاتف' },
    { key: 'contact_email', label: 'Email', labelAr: 'البريد الإلكتروني' },
  ], [lang])

  const clientsTable = useAdminTable({
    tableName: 'clients',
    select: 'id,name_ar,name_en,contact_name,contact_phone,contact_email,created_at',
    columns: clientsColumns,
    canEdit: isAdmin,
    user,
    softDelete: false,
    onDataChanged,
    validateRow: () => ({ error: '', warning: '' }),
    defaultAddValues: {},
  })

  const suppliersColumns = useMemo(() => [
    { key: 'name_ar', label: 'Name (AR)', labelAr: 'اسم المورد (ع)' },
    { key: 'name_en', label: 'Name (EN)', labelAr: 'اسم المورد (EN)' },
    { key: 'category', label: 'Category', labelAr: 'الفئة' },
    { key: 'contact_name', label: 'Contact', labelAr: 'جهة الاتصال' },
    { key: 'contact_phone', label: 'Phone', labelAr: 'الهاتف' },
  ], [lang])

  const suppliersTable = useAdminTable({
    tableName: 'suppliers',
    select: 'id,name_ar,name_en,category,contact_name,contact_phone,created_at',
    columns: suppliersColumns,
    canEdit: isAdmin,
    user,
    softDelete: false,
    onDataChanged,
    validateRow: () => ({ error: '', warning: '' }),
    defaultAddValues: {},
  })

  const categoryColumns = useMemo(() => [
    { key: 'name_ar', label: 'Name (AR)', labelAr: 'الاسم (ع)' },
    { key: 'name_en', label: 'Name (EN)', labelAr: 'الاسم (EN)' },
    {
      key: 'kind',
      label: 'Kind',
      labelAr: 'النوع',
      type: 'select',
      options: [
        { value: 'direct', label: lang === 'ar' ? 'مباشر' : 'Direct' },
        { value: 'indirect', label: lang === 'ar' ? 'غير مباشر' : 'Indirect' },
      ],
    },
  ], [lang])

  const categoriesTable = useAdminTable({
    tableName: 'cost_categories',
    select: 'id,name_ar,name_en,kind,created_at',
    columns: categoryColumns,
    canEdit: isAdmin,
    user,
    softDelete: false,
    onDataChanged,
    validateRow: () => ({ error: '', warning: '' }),
    defaultAddValues: { kind: 'direct' },
  })

  const projectOptions = useMemo(() => projectsTable.rows.map((p) => ({
    value: p.id,
    label: lang === 'ar' ? (p.name_ar || p.name_en) : (p.name_en || p.name_ar),
  })), [projectsTable.rows, lang])

  const supplierOptions = useMemo(() => suppliersTable.rows.map((s) => ({
    value: s.id,
    label: lang === 'ar' ? (s.name_ar || s.name_en) : (s.name_en || s.name_ar),
  })), [suppliersTable.rows, lang])

  const categoryOptions = useMemo(() => categoriesTable.rows.map((c) => ({
    value: c.id,
    label: lang === 'ar' ? (c.name_ar || c.name_en) : (c.name_en || c.name_ar),
  })), [categoriesTable.rows, lang])

  const clientInvoiceColumns = useMemo(() => [
    { key: 'project_id', label: 'Project', labelAr: 'المشروع', type: 'select', options: projectOptions },
    { key: 'invoice_no', label: 'Invoice No', labelAr: 'رقم الفاتورة' },
    { key: 'invoice_date', label: 'Invoice Date', labelAr: 'تاريخ الفاتورة', type: 'date' },
    { key: 'due_date', label: 'Due Date', labelAr: 'تاريخ الاستحقاق', type: 'date' },
    { key: 'amount_net', label: 'Amount Net', labelAr: 'صافي المبلغ', type: 'number' },
    { key: 'vat_amount', label: 'VAT', labelAr: 'ضريبة القيمة المضافة', type: 'number' },
    { key: 'retention_amount', label: 'Retention', labelAr: 'الاستقطاع', type: 'number' },
    { key: 'amount_gross', label: 'Amount Gross', labelAr: 'إجمالي المبلغ', type: 'number' },
    {
      key: 'status',
      label: 'Status',
      labelAr: 'الحالة',
      type: 'select',
      options: [
        { value: 'draft', label: lang === 'ar' ? 'مسودة' : 'Draft' },
        { value: 'submitted', label: lang === 'ar' ? 'مرسل' : 'Submitted' },
        { value: 'approved', label: lang === 'ar' ? 'معتمد' : 'Approved' },
        { value: 'partially_paid', label: lang === 'ar' ? 'مدفوع جزئيًا' : 'Partially Paid' },
        { value: 'paid', label: lang === 'ar' ? 'مدفوع' : 'Paid' },
        { value: 'rejected', label: lang === 'ar' ? 'مرفوض' : 'Rejected' },
      ],
    },
  ], [projectOptions, lang])

  const clientInvoicesTable = useAdminTable({
    tableName: 'client_invoices',
    select: 'id,project_id,invoice_no,invoice_date,due_date,amount_net,vat_amount,retention_amount,amount_gross,status,deleted_at,created_at',
    columns: clientInvoiceColumns,
    canEdit: isAdmin,
    user,
    softDelete: true,
    onDataChanged,
    validateRow: (row, allRows) => {
      const numericKeys = ['amount_net', 'vat_amount', 'retention_amount', 'amount_gross']
      for (const key of numericKeys) {
        const v = toNumberOrNull(row[key])
        if (v != null && v < 0) return { error: lang === 'ar' ? 'المبالغ يجب أن تكون 0 أو أكثر' : 'Amounts must be >= 0' }
      }

      if (row.invoice_date && row.due_date && row.due_date < row.invoice_date) {
        return { error: lang === 'ar' ? 'تاريخ الاستحقاق يجب أن يكون بعد تاريخ الفاتورة' : 'Due date must be on/after invoice date' }
      }

      const duplicate = allRows.find((r) =>
        r.id !== row.id &&
        String(r.project_id || '') === String(row.project_id || '') &&
        String(r.invoice_no || '').trim() !== '' &&
        String(r.invoice_no || '').trim() === String(row.invoice_no || '').trim(),
      )
      if (duplicate) {
        return { warning: lang === 'ar' ? 'تحذير: رقم فاتورة مكرر داخل نفس المشروع' : 'Warning: duplicate invoice_no in the same project' }
      }

      return { error: '', warning: '' }
    },
    buildPatch: ({ row, field, rawValue }) => {
      const baseValue = field.includes('amount') ? Number(rawValue || 0) : rawValue
      const patch = { [field]: baseValue }

      if (field === 'amount_net' || field === 'project_id') {
        const projectId = field === 'project_id' ? rawValue : row.project_id
        const project = projectsTable.rows.find((p) => String(p.id) === String(projectId))
        const net = field === 'amount_net' ? Number(rawValue || 0) : Number(row.amount_net || 0)
        const vat = Number((net * Number(project?.vat_rate || 0)).toFixed(2))
        const retention = Number((net * Number(project?.retention_pct || 0)).toFixed(2))
        const gross = Number((net + vat).toFixed(2))
        patch.vat_amount = vat
        patch.retention_amount = retention
        patch.amount_gross = gross
      }

      return patch
    },
    defaultAddValues: {
      status: 'submitted',
      amount_net: 0,
      vat_amount: 0,
      retention_amount: 0,
      amount_gross: 0,
    },
  })

  const paymentColumns = useMemo(() => [
    { key: 'project_id', label: 'Project', labelAr: 'المشروع', type: 'select', options: projectOptions },
    {
      key: 'client_invoice_id',
      label: 'Client Invoice',
      labelAr: 'فاتورة العميل',
      type: 'select',
      options: clientInvoicesTable.rows.map((row) => ({ value: row.id, label: row.invoice_no || row.id })),
    },
    { key: 'payment_date', label: 'Payment Date', labelAr: 'تاريخ الدفع', type: 'date' },
    { key: 'amount', label: 'Amount', labelAr: 'المبلغ', type: 'number' },
    {
      key: 'method',
      label: 'Method',
      labelAr: 'طريقة الدفع',
      type: 'select',
      options: [
        { value: 'bank_transfer', label: lang === 'ar' ? 'تحويل بنكي' : 'Bank Transfer' },
        { value: 'cash', label: lang === 'ar' ? 'نقدي' : 'Cash' },
        { value: 'cheque', label: lang === 'ar' ? 'شيك' : 'Cheque' },
      ],
    },
  ], [projectOptions, clientInvoicesTable.rows, lang])

  const clientPaymentsTable = useAdminTable({
    tableName: 'client_payments',
    select: 'id,project_id,client_invoice_id,payment_date,amount,method,deleted_at,created_at',
    columns: paymentColumns,
    canEdit: isAdmin,
    user,
    softDelete: true,
    onDataChanged,
    validateRow: (row) => {
      const amount = toNumberOrNull(row.amount)
      if (amount != null && amount < 0) return { error: lang === 'ar' ? 'المبلغ يجب أن يكون 0 أو أكثر' : 'Amount must be >= 0' }
      return { error: '', warning: '' }
    },
    defaultAddValues: { method: 'bank_transfer', amount: 0 },
  })

  const supplierInvoiceColumns = useMemo(() => [
    { key: 'supplier_id', label: 'Supplier', labelAr: 'المورد', type: 'select', options: supplierOptions },
    { key: 'project_id', label: 'Project', labelAr: 'المشروع', type: 'select', options: projectOptions },
    { key: 'cost_category_id', label: 'Cost Category', labelAr: 'فئة التكلفة', type: 'select', options: categoryOptions },
    { key: 'invoice_no', label: 'Invoice No', labelAr: 'رقم الفاتورة' },
    { key: 'invoice_date', label: 'Invoice Date', labelAr: 'تاريخ الفاتورة', type: 'date' },
    { key: 'due_date', label: 'Due Date', labelAr: 'تاريخ الاستحقاق', type: 'date' },
    { key: 'amount_net', label: 'Amount Net', labelAr: 'صافي المبلغ', type: 'number' },
    { key: 'vat_amount', label: 'VAT', labelAr: 'الضريبة', type: 'number' },
    { key: 'amount_gross', label: 'Amount Gross', labelAr: 'إجمالي المبلغ', type: 'number' },
    {
      key: 'status',
      label: 'Status',
      labelAr: 'الحالة',
      type: 'select',
      options: [
        { value: 'draft', label: lang === 'ar' ? 'مسودة' : 'Draft' },
        { value: 'received', label: lang === 'ar' ? 'مستلمة' : 'Received' },
        { value: 'approved', label: lang === 'ar' ? 'معتمدة' : 'Approved' },
        { value: 'partially_paid', label: lang === 'ar' ? 'مدفوعة جزئيًا' : 'Partially Paid' },
        { value: 'paid', label: lang === 'ar' ? 'مدفوعة' : 'Paid' },
        { value: 'disputed', label: lang === 'ar' ? 'متنازع عليها' : 'Disputed' },
      ],
    },
  ], [supplierOptions, projectOptions, categoryOptions, lang])

  const supplierInvoicesTable = useAdminTable({
    tableName: 'supplier_invoices',
    select: 'id,supplier_id,project_id,cost_category_id,invoice_no,invoice_date,due_date,amount_net,vat_amount,amount_gross,status,deleted_at,created_at',
    columns: supplierInvoiceColumns,
    canEdit: isAdmin,
    user,
    softDelete: true,
    onDataChanged,
    validateRow: (row, allRows) => {
      const numericKeys = ['amount_net', 'vat_amount', 'amount_gross']
      for (const key of numericKeys) {
        const v = toNumberOrNull(row[key])
        if (v != null && v < 0) return { error: lang === 'ar' ? 'المبالغ يجب أن تكون 0 أو أكثر' : 'Amounts must be >= 0' }
      }

      if (row.invoice_date && row.due_date && row.due_date < row.invoice_date) {
        return { error: lang === 'ar' ? 'تاريخ الاستحقاق يجب أن يكون بعد تاريخ الفاتورة' : 'Due date must be on/after invoice date' }
      }

      const duplicate = allRows.find((r) =>
        r.id !== row.id &&
        String(r.project_id || '') === String(row.project_id || '') &&
        String(r.invoice_no || '').trim() !== '' &&
        String(r.invoice_no || '').trim() === String(row.invoice_no || '').trim(),
      )
      if (duplicate) {
        return { warning: lang === 'ar' ? 'تحذير: رقم فاتورة مكرر داخل نفس المشروع' : 'Warning: duplicate invoice_no in the same project' }
      }

      return { error: '', warning: '' }
    },
    buildPatch: ({ row, field, rawValue }) => {
      const patch = { [field]: field.includes('amount') ? Number(rawValue || 0) : rawValue }
      if (field === 'amount_net') {
        const net = Number(rawValue || 0)
        const vat = Number((net * 0.15).toFixed(2))
        patch.vat_amount = vat
        patch.amount_gross = Number((net + vat).toFixed(2))
      }
      return patch
    },
    defaultAddValues: {
      status: 'received',
      amount_net: 0,
      vat_amount: 0,
      amount_gross: 0,
    },
  })

  const sections = [
    { key: 'projects', title: lang === 'ar' ? 'المشاريع' : 'Projects', table: projectsTable, columns: projectColumns, hardDelete: true },
    { key: 'clients', title: lang === 'ar' ? 'العملاء' : 'Clients', table: clientsTable, columns: clientsColumns, hardDelete: true },
    { key: 'suppliers', title: lang === 'ar' ? 'الموردون' : 'Suppliers', table: suppliersTable, columns: suppliersColumns, hardDelete: true },
    { key: 'cost_categories', title: lang === 'ar' ? 'فئات التكلفة' : 'Cost Categories', table: categoriesTable, columns: categoryColumns, hardDelete: true },
    { key: 'client_invoices', title: lang === 'ar' ? 'فواتير العملاء' : 'Client Invoices', table: clientInvoicesTable, columns: clientInvoiceColumns, hardDelete: false },
    { key: 'client_payments', title: lang === 'ar' ? 'مدفوعات العملاء' : 'Client Payments', table: clientPaymentsTable, columns: paymentColumns, hardDelete: false },
    { key: 'supplier_invoices', title: lang === 'ar' ? 'فواتير الموردين' : 'Supplier Invoices', table: supplierInvoicesTable, columns: supplierInvoiceColumns, hardDelete: false },
  ]

  const anyLoading = sections.some((section) => section.table.loading)

  const tableErrors = sections
    .map((section) => section.table.globalError)
    .filter(Boolean)

  const onDelete = async (section, row) => {
    if (!isAdmin) return
    if (section.hardDelete) {
      const ok = window.confirm(lang === 'ar' ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete this row?')
      if (!ok) return
    }
    await section.table.deleteRow(row)
  }

  const onRefreshRole = async () => {
    setRoleRefreshError('')
    try {
      await refreshRole()
    } catch (error) {
      setRoleRefreshError(error?.message || (lang === 'ar' ? 'تعذر تحديث الدور' : 'Failed to refresh role'))
    }
  }

  return (
    <div>
      <h1 className="display">{lang === 'ar' ? 'إدارة البيانات' : 'Data Admin'}</h1>
      <p className="card-sub" style={{ marginTop: 6 }}>
        {isAdmin
          ? (lang === 'ar' ? 'التعديلات تُحفَظ تلقائيًا بعد فترة قصيرة.' : 'Edits autosave after a short delay.')
          : (lang === 'ar' ? 'عرض فقط. أدوات التعديل مخفية لغير المسؤولين.' : 'Read-only mode. Edit controls are hidden for non-admin users.')}
      </p>
      <p className="card-sub" style={{ marginTop: 2 }}>
        {lang === 'ar' ? `الدور الحالي: ${role || 'viewer'}` : `Current role: ${role || 'viewer'}`}
      </p>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn secondary" onClick={onRefreshRole} disabled={refreshingRole}>
          {refreshingRole
            ? (lang === 'ar' ? 'جاري التحديث...' : 'Refreshing...')
            : (lang === 'ar' ? 'تحديث الدور' : 'Refresh role')}
        </button>
        {roleRefreshError && (
          <span className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>
            {roleRefreshError}
          </span>
        )}
      </div>

      {anyLoading && <div className="card-sub" style={{ marginTop: 10 }}>{lang === 'ar' ? 'تحميل الجداول...' : 'Loading tables...'}</div>}

      {tableErrors.length > 0 && (
        <div className="card" style={{ margin: '12px 0' }}>
          <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>
            {tableErrors[0]}
          </div>
        </div>
      )}

      {sections.map((section) => (
        <div key={section.key}>
          <EditableTable
            title={section.title}
            lang={lang}
            columns={section.columns}
            rows={section.table.rows}
            canEdit={isAdmin}
            onOpenAdd={() => setOpenModal(section.key)}
            onChangeCell={section.table.onChangeCell}
            onDeleteRow={(row) => onDelete(section, row)}
            statusByCell={section.table.statusByCell}
            rowWarnings={section.table.rowWarnings}
            rowErrors={section.table.rowErrors}
            emptyLabel={lang === 'ar' ? 'لا توجد بيانات' : 'No records yet'}
          />

          <RecordFormModal
            open={openModal === section.key}
            title={lang === 'ar' ? `إضافة ${section.title}` : `Add ${section.title}`}
            columns={section.columns}
            initialValues={{}}
            submitLabel={lang === 'ar' ? 'حفظ' : 'Save'}
            onClose={() => setOpenModal('')}
            onSubmit={section.table.addRow}
            lang={lang}
          />
        </div>
      ))}
    </div>
  )
}
