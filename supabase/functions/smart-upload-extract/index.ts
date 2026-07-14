const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type UploadMode = 'single' | 'statement'

type ExtractRequest = {
  mode: UploadMode
  lang?: 'ar' | 'en'
  file: {
    name: string
    type: string
    size: number
    base64: string
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function buildPrompt(mode: UploadMode, lang: string) {
  const languageHint = lang === 'ar'
    ? 'The document may be in Arabic and include RTL numerals. Convert all extracted numbers/dates to standard machine-readable values.'
    : 'The document may be bilingual (Arabic/English). Normalize numerals and dates to machine-readable values.'

  if (mode === 'single') {
    return `${languageHint}
Extract ONE invoice from the attached file.
Return STRICT JSON only with this exact shape:
{
  "direction": "supplier|client",
  "invoice_no": "string",
  "invoice_date": "YYYY-MM-DD or empty",
  "due_date": "YYYY-MM-DD or empty",
  "supplier_or_client_name": "string",
  "amount_net": "number-like string",
  "vat_amount": "number-like string",
  "amount_gross": "number-like string",
  "currency": "ISO code like SAR",
  "confidence_notes": {
    "direction": "short note",
    "invoice_no": "short note",
    "invoice_date": "short note",
    "due_date": "short note",
    "supplier_or_client_name": "short note",
    "amount_net": "short note",
    "vat_amount": "short note",
    "amount_gross": "short note",
    "currency": "short note"
  }
}
No markdown, no prose, no extra keys.`
  }

  return `${languageHint}
Extract ALL transaction rows from the attached account statement.
Return STRICT JSON only with this exact shape:
{
  "rows": [
    {
      "date": "YYYY-MM-DD or empty",
      "description": "string",
      "invoice_no": "string or empty",
      "debit": "number-like string or 0",
      "credit": "number-like string or 0",
      "running_balance": "number-like string or empty"
    }
  ]
}
No markdown, no prose, no extra keys.`
}

function extractTextFromAnthropicResponse(payload: any) {
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  const texts = blocks
    .filter((block: any) => block?.type === 'text')
    .map((block: any) => String(block?.text || ''))
    .join('\n')
  return texts.trim()
}

function tryParseJson(rawText: string) {
  try {
    return { parsed: JSON.parse(rawText), ok: true }
  } catch {
    // continue
  }

  const objectMatch = rawText.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try {
      return { parsed: JSON.parse(objectMatch[0]), ok: true }
    } catch {
      // continue
    }
  }

  const arrayMatch = rawText.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      return { parsed: JSON.parse(arrayMatch[0]), ok: true }
    } catch {
      // continue
    }
  }

  return { parsed: null, ok: false }
}

function buildDocumentBlock(file: ExtractRequest['file']) {
  if (file.type === 'application/pdf') {
    return {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: file.base64,
      },
    }
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: file.type,
      data: file.base64,
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return jsonResponse({ ok: false, error: 'ANTHROPIC_API_KEY is not configured in Edge Function secrets.' }, 500)
    }

    const body = await req.json() as ExtractRequest
    const mode = body?.mode === 'statement' ? 'statement' : 'single'
    const file = body?.file

    if (!file?.base64 || !file?.type) {
      return jsonResponse({ ok: false, error: 'Missing file payload.' }, 400)
    }

    const prompt = buildPrompt(mode, body?.lang || 'en')
    const docBlock = buildDocumentBlock(file)

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              docBlock,
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    const raw = await anthropicRes.text()
    if (!anthropicRes.ok) {
      return jsonResponse({ ok: false, error: `Anthropic API failed: ${anthropicRes.status}`, raw_text: raw }, 502)
    }

    let apiPayload: any = null
    try {
      apiPayload = JSON.parse(raw)
    } catch {
      return jsonResponse({ ok: false, error: 'Failed to parse Anthropic API response.', raw_text: raw }, 502)
    }

    const modelText = extractTextFromAnthropicResponse(apiPayload)
    const parsedJson = tryParseJson(modelText)

    if (!parsedJson.ok) {
      return jsonResponse({ ok: false, error: 'Model response was not valid JSON.', raw_text: modelText })
    }

    return jsonResponse({ ok: true, parsed: parsedJson.parsed, raw_text: modelText })
  } catch (error) {
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : 'Unexpected failure' }, 500)
  }
})
