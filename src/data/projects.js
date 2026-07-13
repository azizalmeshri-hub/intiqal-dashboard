// Data derived from statements provided (2025-2026).
// today() is fixed to the conversation date so risk calculations are stable/testable.
export const TODAY = new Date('2026-07-13')

// ---- Monthly billed history (from actual invoice dates in client ledgers) ----
// Used to draw the "actual" cumulative billing line on the S-curve.
export const sadraMonthlyBilled = [
  { month: '2025-05', amount: 74116.35 },
  { month: '2025-06', amount: 119844.73 },
  { month: '2025-08', amount: 238377.35 },
  { month: '2025-10', amount: 575454.28 },
  { month: '2025-11', amount: 213320.36 },
  { month: '2025-12', amount: 235063.76 },
  { month: '2026-03', amount: 244334.87 },
  { month: '2026-05', amount: 223496.02 },
  { month: '2026-06', amount: 123088.05 },
]

export const ajdanMonthlyBilled = [
  { month: '2025-12', amount: 1719056.51 },
  { month: '2026-01', amount: 1174273.30 },
  { month: '2026-02', amount: 1600576.30 },
  { month: '2026-03', amount: 1005872.16 },
  { month: '2026-04', amount: 1180672.50 },
  { month: '2026-05', amount: 1105530.50 },
  { month: '2026-06', amount: 1183760.19 },
]

export const projects = {
  sadra: {
    id: 'sadra',
    name_ar: 'مشروع سدرة – بواسطة روشن',
    name_en: 'Sadra Project — by Roshn',
    owner_ar: 'شركة روشن (المالك) عبر شركة التعمير والإنشاء',
    owner_en: 'Roshn (Owner) via Building Construction Co. Ltd',
    role_ar: 'انتقال (مقاول من الباطن) — الأعمال المدنية والبنية التحتية',
    role_en: 'Intiqal (Subcontractor) — civil & infrastructure works',
    contractor_ar: 'شركة التشييد الاختصاصية للمقاولات (المقاول الرئيسي المستأجر من انتقال)',
    contractor_en: 'Specialized Building Contracting Co. (main contractor hired by Intiqal)',
    location_ar: 'الرياض',
    location_en: 'Riyadh',
    contractValue: null,
    contractValuePlaceholder: 3200000,
    startDate: '2025-05-01',
    endDate: '2026-08-31',
    percentComplete: 95,
    pos: ['BPO32502845', 'BPO32504016'],
    monthlyBilled: sadraMonthlyBilled,
    clientLedgers: [
      { po: 'BPO32502845', outstanding: 15511.35, lastInvoiceDate: '2026-06-22' },
      { po: 'BPO32504016', outstanding: 107576.70, lastInvoiceDate: '2026-06-22' },
    ],
    contractorPayable: {
      name_ar: 'شركة التشييد الاختصاصية للمقاولات',
      name_en: 'Specialized Building Contracting Co.',
      totalInvoiced: 1654561.91,
      totalPaid: 1577533.00,
      outstanding: 77029,
      lastInvoiceDate: '2026-05-10',
    },
  },
  ajdan: {
    id: 'ajdan',
    name_ar: 'مشروع أجدان — الإسكان الوطنية',
    name_en: 'Ajdan Project — National Housing Company (NHC)',
    owner_ar: 'شركة الإسكان الوطنية (NHC) عبر شركة الأولى منازل للمقاولات',
    owner_en: 'National Housing Company (NHC) via Al Oula Manazil Contracting',
    role_ar: 'انتقال (مقاول من الباطن) — حفر وبنية تحتية وتنفيذ الفلل الدوبلكس بالكامل',
    role_en: 'Intiqal (Subcontractor) — excavation, infrastructure & full duplex construction',
    location_ar: 'المملكة العربية السعودية',
    location_en: 'Saudi Arabia',
    contractValue: 59793270.00,
    startDate: '2025-12-01',
    endDate: '2028-04-13',
    advancePaymentPct: 2.5,
    advancePayment: 1494831.75,
    retentionPct: 15,
    completedInclAdvance: 68762260.50,
    remainingOnProject: 8969741.44,
    pos: ['NHC-AJDAN'],
    monthlyBilled: ajdanMonthlyBilled,
    clientLedgerSummary: {
      totalInvoiced: 8094054.91 + 1214108.24,
      totalReceived: 7785981.25,
      outstanding: 1183760.19,
      lastInvoiceDate: '2026-06-29',
    },
    suppliersContractors: [
      { name_ar: 'الناقول (خرسانة جاهزة)', name_en: 'Al Naqool (Ready Mix)', weOwe: 427650, type: 'we_owe', lastActivity: '2026-05-20' },
      { name_ar: 'أفال العربية للمقاولات', name_en: 'Afal Arabia Contracting', weOwe: 49882, type: 'we_owe', lastActivity: '2026-04-30' },
      { name_ar: 'قوة معمارية APCo', name_en: 'APCo (Building Materials)', weOwe: 34185, type: 'we_owe', lastActivity: '2026-06-07' },
      { name_ar: 'مورد حديد (تسليح/مصدر)', name_en: 'Rebar Supplier', weOwe: 1291260 + 64620, type: 'we_owe', lastActivity: '2026-06-01' },
      {
        name_ar: 'BRKZ (خرسانة)', name_en: 'BRKZ International (Concrete)', weOwe: 188371.35, type: 'we_owe', lastActivity: '2026-06-15',
        aging: { current: 181010.85, d30: 7360.50, d60: 0, d90: 0, d90plus: 0 },
      },
      { name_ar: 'سابرو (سباكة وبلاستيك)', name_en: 'Sabro (Plumbing & Plastics)', weOwe: 16072, type: 'we_owe', lastActivity: '2026-05-10' },
      {
        name_ar: 'مؤسسة بنود الإنشاء', name_en: 'Bnood Al-Ensha Trading Est.', weOwe: 76346.79, type: 'we_owe', lastActivity: '2026-04-30',
        aging: { current: 28488.48, d30: 17574.30, d60: 30284.00, d90: 0, d90plus: 0 },
      },
      { name_ar: 'مؤسسة نور العلياء', name_en: "Noor Al-Alia'a Gen. Cont.", weOwe: 193359.00, type: 'we_owe', lastActivity: '2026-04-07' },
      { name_ar: 'شركة كان الإنشائية (ريدي مكس)', name_en: 'Kan Construction (Ready Mix)', weOwe: 411515.00, type: 'we_owe', lastActivity: '2026-04-30' },
    ],
  },
}

export const companySummary = {
  totalReceivableFromClients: 2310765,
  totalPayableToSuppliers: 2830290.14,
  currency: 'SAR',
}
