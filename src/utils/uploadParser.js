import * as XLSX from 'xlsx'

const normalizeText = (value = '') => String(value ?? '').trim().replace(/\s+/g, ' ').replace(/^['"\s]+|['"\s]+$/g, '')

const parseAmount = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = normalizeText(value)
  if (!text) return null

  const cleaned = text.replace(/,/g, '')
  const matches = cleaned.match(/-?\d+(?:\.\d{1,2})?/g)
  if (!matches || !matches.length) return null

  // Prefer realistic currency-like amounts over sequence numbers/dates.
  const sorted = matches
    .map((token) => Number(token))
    .filter((num) => Number.isFinite(num) && Math.abs(num) >= 10)
    .sort((a, b) => Math.abs(b) - Math.abs(a))

  const parsed = sorted.length ? sorted[0] : Number(matches[0])
  return Number.isFinite(parsed) ? parsed : null
}

const scoreProjectFromText = (haystack) => {
  const sadraSignals = /(sadra|سدرة|project a|project_?a|site a|tower a|phase a|package a|sdra)/
  const ajdanSignals = /(ajdan|أجدان|project b|project_?b|site b|tower b|phase b|package b|ajdn)/

  const sadra = sadraSignals.test(haystack)
  const ajdan = ajdanSignals.test(haystack)

  if (sadra && !ajdan) return { project: 'sadra', certainty: 0.92 }
  if (ajdan && !sadra) return { project: 'ajdan', certainty: 0.92 }
  if (sadra && ajdan) return { project: 'sadra', certainty: 0.7 }

  if (/(subcontract|materials|labour|foundation|earthwork|civil)/.test(haystack)) {
    return { project: 'sadra', certainty: 0.66 }
  }
  if (/(villa|duplex|handover|unit|client|statement|receipt)/.test(haystack)) {
    return { project: 'ajdan', certainty: 0.66 }
  }

  return { project: 'sadra', certainty: 0.5 }
}

const detectType = (value = '', fileName = '') => {
  const haystack = `${fileName} ${value}`.toLowerCase()
  if (/(المقاولين والموردين|contractors?\s*&\s*suppliers?|suppliers?\s*&\s*contractors?)/.test(haystack)) {
    return { type: 'payable', certainty: 0.98 }
  }
  if (/(invoice|bill|supplier|expense|payable|فاتورة|مورد|مصروف|دائن|مدفوعات|statement|bank|vendor|contractor)/.test(haystack)) return { type: 'payable', certainty: 0.9 }
  if (/(receipt|client|receivable|incoming|عميل|مستحق|قبض|إيراد|collection|transfer in)/.test(haystack)) return { type: 'receivable', certainty: 0.9 }
  return { type: 'payable', certainty: 0.55 }
}

const pickValue = (row, headers, keys) => {
  const headerIndex = headers.findIndex((header) => keys.some((key) => header.includes(key)))
  if (headerIndex >= 0) return row[headerIndex] ?? ''
  return row.find((cell) => normalizeText(cell)) ?? ''
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const buildSuggestion = ({ desc, amount, project, projectCertainty, type, typeCertainty, source, fileName, rawText = '' }) => {
  const safeDesc = normalizeText(desc) || `Imported ${source}`
  const amountConfidence = amount && Number(amount) > 0 ? 0.92 : 0.35
  const descConfidence = safeDesc.length > 4 ? 0.9 : 0.5
  const confidence = clamp((projectCertainty + typeCertainty + amountConfidence + descConfidence) / 4, 0.35, 0.98)

  return {
    desc: safeDesc,
    amount: amount ?? 0,
    project,
    type,
    source,
    fileName,
    rawText: normalizeText(rawText),
    confidence,
  }
}

const mapCommonSuggestion = ({ description, amount, projectHint, typeHint, source, fileName, rawText }) => {
  const projectMeta = scoreProjectFromText(`${fileName} ${projectHint} ${description} ${rawText}`.toLowerCase())
  const typeMeta = detectType(`${typeHint} ${description} ${rawText}`, fileName)

  return buildSuggestion({
    desc: description,
    amount,
    project: projectMeta.project,
    projectCertainty: projectMeta.certainty,
    type: typeMeta.type,
    typeCertainty: typeMeta.certainty,
    source,
    fileName,
    rawText,
  })
}

export function parseCsvText(text, fileName = '') {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replace(/^['"]|['"]$/g, '').trim()))

  if (!rows.length) return []

  const [headerRow, ...dataRows] = rows
  const headers = (headerRow || []).map((header) => normalizeText(header).toLowerCase())
  const candidates = dataRows.length ? dataRows : rows

  return candidates
    .filter((row) => row.some((cell) => normalizeText(cell)))
    .map((row) => {
      const description = pickValue(row, headers, ['description', 'desc', 'details', 'item', 'memo', 'reference', 'name'])
      const amount = parseAmount(pickValue(row, headers, ['amount', 'amt', 'value', 'total', 'sum', 'invoice amount']))
      const projectHint = pickValue(row, headers, ['project', 'site', 'job'])
      const typeHint = pickValue(row, headers, ['type', 'document', 'doc type'])

      return mapCommonSuggestion({
        description: description || row[0],
        amount,
        projectHint,
        typeHint,
        source: 'csv',
        fileName,
        rawText: row.join(' | '),
      })
    })
    .filter((suggestion) => suggestion.desc && suggestion.amount)
}

export function parseTextContent(text, fileName = '') {
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean)

  if (!lines.length) return []

  const combinedText = lines.join(' ')
  const description = lines.find((line) => !/sar|amount|invoice|bill|receipt|payable|receivable/i.test(line)) || lines[0]
  const amount = parseAmount(combinedText)

  if (!amount) return []

  return [
    mapCommonSuggestion({
      description,
      amount,
      projectHint: combinedText,
      typeHint: combinedText,
      source: 'text',
      fileName,
      rawText: combinedText,
    }),
  ]
}

export async function parsePdfContent(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjs.getDocument({ data, disableWorker: true })
  const pdf = await loadingTask.promise

  let allText = ''
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const text = await page.getTextContent()
    const pageText = text.items.map((item) => item.str || '').join(' ')
    allText += `${pageText}\n`
  }

  const lines = allText
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter((line) => line.length > 3)

  const suggestedRows = lines
    .filter((line) => /\d/.test(line) && /[A-Za-z\u0600-\u06FF]/.test(line))
    .map((line) => {
      const amount = parseAmount(line)
      if (!amount) return null
      return mapCommonSuggestion({
        description: line,
        amount,
        projectHint: `${file.name} ${line}`,
        typeHint: `${file.name} ${line}`,
        source: 'pdf',
        fileName: file.name,
        rawText: line,
      })
    })
    .filter(Boolean)

  if (suggestedRows.length) return suggestedRows
  return parseTextContent(allText, file.name)
}

export async function parseUploadedFile(file) {
  const name = (file?.name || '').toLowerCase()

  if (name.endsWith('.csv')) {
    const text = await file.text()
    return parseCsvText(text, file.name)
  }

  if (name.endsWith('.txt')) {
    const text = await file.text()
    return parseTextContent(text, file.name)
  }

  if (name.endsWith('.pdf')) {
    return parsePdfContent(file)
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const data = await file.arrayBuffer()
    const workbook = XLSX.read(data, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    if (!rows.length) return []

    return rows
      .map((row) => {
        const entries = Object.entries(row)
        const values = entries.map(([, value]) => normalizeText(value))
        const headers = entries.map(([key]) => normalizeText(key).toLowerCase())

        const description = values.find((value) => /[A-Za-z\u0600-\u06FF]/.test(value)) || values[0] || ''
        const amount = parseAmount(values.find((value) => /\d/.test(value)) || '')
        const projectHint = pickValue(values, headers, ['project', 'site', 'job'])
        const typeHint = pickValue(values, headers, ['type', 'document', 'doc type'])

        return mapCommonSuggestion({
          description,
          amount,
          projectHint,
          typeHint,
          source: 'spreadsheet',
          fileName: file.name,
          rawText: values.join(' | '),
        })
      })
      .filter((suggestion) => suggestion.desc && suggestion.amount)
  }

  return []
}
