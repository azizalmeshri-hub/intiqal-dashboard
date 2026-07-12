// Data derived from company statements provided (2025-2026).
// Placeholder values are explicitly marked — replace via the Data Entry screen.

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
    contractValue: null, // PLACEHOLDER — user will confirm exact contract value
    contractValuePlaceholder: 3200000, // rough placeholder for chart scale only
    percentComplete: 95,
    status: 'on-track',
    pos: ['BPO32502845', 'BPO32504016'],
    clientLedgers: [
      {
        po: 'BPO32502845',
        label_ar: 'مشروع سدرة (روشن)',
        invoicedTotal: 15511.35 + 74116.35 + 119844.73 + 137003.00 + 41757.10 + 303798.28 + 155307.24 + 118071.80 + 83611.32 + 124407.36,
        outstanding: 15511.35,
        currency: 'SAR',
      },
      {
        po: 'BPO32504016',
        label_ar: 'مشروع سدرة (روشن) - تعمير 2',
        outstanding: 107576.70,
        currency: 'SAR',
      },
    ],
    contractorPayable: {
      name_ar: 'شركة التشييد الاختصاصية للمقاولات',
      totalInvoiced: 1654561.91,
      totalPaid: 1577533.00,
      outstanding: 77029, // matches company-wide "ملخص المتبقي" sheet
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
    advancePaymentPct: 2.5,
    advancePayment: 1494831.75,
    retentionPct: 15,
    completedInclAdvance: 68762260.50,
    remainingOnProject: 8969741.44,
    percentComplete: Math.round((68762260.50 / 59793270.00) * 10000) / 100,
    status: 'on-track',
    clientLedger_ar: 'شركة الأولى منازل للمقاولات',
    clientLedgerSummary: {
      totalInvoiced: 8094054.91 + 1214108.24,
      totalReceived: 7785981.25,
      outstanding: 1183760.19,
    },
    suppliersContractors: [
      { name_ar: 'الناقول (خرسانة جاهزة)', name_en: 'Al Naqool (Ready Mix)', outstandingToUs: 427650, type: 'we_are_owed' },
      { name_ar: 'أفال العربية للمقاولات', name_en: 'Afal Arabia Contracting', outstandingToUs: 49882, type: 'we_are_owed' },
      { name_ar: 'قوة معمارية APCo', name_en: 'APCo (Building Materials)', outstandingToUs: 34185, type: 'we_are_owed' },
      { name_ar: 'مورد حديد (تسليح/مصدر)', name_en: 'Rebar Supplier', outstandingToUs: 1291260 + 64620, type: 'we_are_owed' },
      { name_ar: 'BRKZ (خرسانة)', name_en: 'BRKZ International (Concrete)', weOwe: 188371.35, type: 'we_owe' },
      { name_ar: 'سابرو (سباكة وبلاستيك)', name_en: 'Sabro (Plumbing & Plastics)', outstandingToUs: 16072, type: 'we_are_owed' },
      { name_ar: 'مؤسسة بنود الإنشاء', name_en: 'Bnood Al-Ensha Trading Est.', weOwe: 76346.79, type: 'we_owe' },
      { name_ar: 'مؤسسة نور العلياء', name_en: 'Noor Al-Alia\'a Gen. Cont.', weOwe: 193359.00, type: 'we_owe' },
      { name_ar: 'شركة كان الإنشائية (ريدي مكس)', name_en: 'Kan Construction (Ready Mix)', weOwe: 411515.00, type: 'we_owe' },
    ],
  },
}

export const companySummary = {
  totalReceivableFromClients: 2310765,
  totalPayableToSuppliers: 0,
  currency: 'SAR',
}
