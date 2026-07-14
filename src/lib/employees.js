export const EMPLOYEE_DOC_BUCKET = 'employee-docs'
export const MAX_EMPLOYEE_FILE_SIZE = 10 * 1024 * 1024
export const ALLOWED_EMPLOYEE_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png']

export function employeeStatusOptions(lang) {
  return [
    { value: 'active', label: lang === 'ar' ? 'نشط' : 'Active' },
    { value: 'inactive', label: lang === 'ar' ? 'غير نشط' : 'Inactive' },
    { value: 'on_leave', label: lang === 'ar' ? 'في إجازة' : 'On Leave' },
    { value: 'terminated', label: lang === 'ar' ? 'منتهي' : 'Terminated' },
  ]
}

export function contractTypeOptions(lang) {
  return [
    { value: 'fixed_term', label: lang === 'ar' ? 'محدد المدة' : 'Fixed Term' },
    { value: 'unlimited', label: lang === 'ar' ? 'غير محدد المدة' : 'Unlimited' },
  ]
}

export function friendlyEmployeeError(error, lang) {
  const message = String(error?.message || '')
  if (message.includes('employees_contract_type_check')) {
    return lang === 'ar'
      ? 'قيمة نوع العقد غير مقبولة في قاعدة البيانات. القيم المتاحة حاليًا هي: محدد المدة أو غير محدد المدة.'
      : 'The selected contract type is not accepted by the database. The accepted values are currently Fixed Term or Unlimited.'
  }
  return message || (lang === 'ar' ? 'تعذر حفظ الموظف.' : 'Failed to save employee.')
}

export function sponsorshipOptions(lang) {
  return [
    { value: 'true', label: lang === 'ar' ? 'نعم' : 'Yes' },
    { value: 'false', label: lang === 'ar' ? 'لا' : 'No' },
  ]
}

export function documentTypeOptions(lang) {
  return [
    { value: 'iqama', label: lang === 'ar' ? 'إقامة' : 'Iqama' },
    { value: 'work_permit', label: lang === 'ar' ? 'تصريح عمل' : 'Work Permit' },
    { value: 'passport', label: lang === 'ar' ? 'جواز سفر' : 'Passport' },
    { value: 'contract', label: lang === 'ar' ? 'عقد' : 'Contract' },
    { value: 'medical', label: lang === 'ar' ? 'طبي' : 'Medical' },
    { value: 'other', label: lang === 'ar' ? 'أخرى' : 'Other' },
  ]
}

export function formatEmployeeName(employee, lang) {
  if (!employee) return '-'
  return lang === 'ar'
    ? (employee.name_ar || employee.name_en || employee.id)
    : (employee.name_en || employee.name_ar || employee.id)
}

export function formatProjectName(project, lang) {
  if (!project) return '-'
  return lang === 'ar'
    ? (project.name_ar || project.name_en || project.id)
    : (project.name_en || project.name_ar || project.id)
}

export function getDocumentTypeLabel(docType, lang) {
  const match = documentTypeOptions(lang).find((opt) => opt.value === docType)
  return match?.label || docType || '-'
}

function startOfToday() {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now
}

export function getDaysToExpiry(expiryDate) {
  if (!expiryDate) return null
  const today = startOfToday()
  const date = new Date(expiryDate)
  date.setHours(0, 0, 0, 0)
  return Math.round((date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

export function getExpiryStatusKey(daysToExpiry) {
  if (daysToExpiry == null) return 'no-expiry'
  if (daysToExpiry < 0) return 'expired'
  if (daysToExpiry <= 30) return 'critical'
  if (daysToExpiry <= 90) return 'warning'
  return 'ok'
}

export function getExpiryStatusMeta(daysToExpiry, lang) {
  const key = getExpiryStatusKey(daysToExpiry)
  if (key === 'expired') {
    return { key, label: lang === 'ar' ? 'منتهي' : 'Expired' }
  }
  if (key === 'critical') {
    return { key, label: lang === 'ar' ? 'حرج' : 'Critical' }
  }
  if (key === 'warning') {
    return { key, label: lang === 'ar' ? 'تنبيه' : 'Warning' }
  }
  if (key === 'ok') {
    return { key, label: lang === 'ar' ? 'سليم' : 'OK' }
  }
  return { key, label: lang === 'ar' ? 'بدون انتهاء' : 'No Expiry' }
}

export function humanizeDaysToExpiry(daysToExpiry, lang) {
  if (daysToExpiry == null) return lang === 'ar' ? 'بدون تاريخ انتهاء' : 'No expiry date'
  if (daysToExpiry < 0) {
    const days = Math.abs(daysToExpiry)
    return lang === 'ar' ? `منتهي منذ ${days} يوم` : `Expired ${days} days ago`
  }
  if (daysToExpiry === 0) return lang === 'ar' ? 'ينتهي اليوم' : 'Expires today'
  return lang === 'ar' ? `خلال ${daysToExpiry} يوم` : `In ${daysToExpiry} days`
}

export function formatDateValue(value, lang) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function buildEmployeeExpirySummary(documents) {
  const summary = { expired: 0, critical: 0, warning: 0 }
  for (const row of documents || []) {
    const key = getExpiryStatusKey(getDaysToExpiry(row.expiry_date))
    if (key === 'expired' || key === 'critical' || key === 'warning') summary[key] += 1
  }
  return summary
}

export function buildExpiringDocumentsList(documents, employeesById, projectsById, lang) {
  return (documents || [])
    .map((row) => {
      const employee = employeesById[row.employee_id]
      const daysToExpiry = getDaysToExpiry(row.expiry_date)
      return {
        ...row,
        employeeName: formatEmployeeName(employee, lang),
        projectName: formatProjectName(projectsById[employee?.project_id], lang),
        docTypeLabel: getDocumentTypeLabel(row.doc_type, lang),
        daysToExpiry,
      }
    })
    .filter((row) => row.daysToExpiry != null && row.daysToExpiry <= 90)
    .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
}

export function countEmployeeSoonDocs(documents) {
  return (documents || []).filter((row) => {
    const days = getDaysToExpiry(row.expiry_date)
    return days != null && days <= 90
  }).length
}

export function normalizeBooleanValue(value) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return null
}

export function normalizeNumberValue(value) {
  if (value === '' || value == null) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export function employeeDocBucketMissingMessage(lang) {
  return lang === 'ar'
    ? 'فشل رفع الملف. تأكد من إنشاء حاوية خاصة باسم employee-docs في Supabase Storage.'
    : 'Upload failed. Create a private Supabase Storage bucket named employee-docs first.'
}

export function employeeDocValidationMessage(file, lang) {
  if (!file) return lang === 'ar' ? 'اختر ملفًا للرفع.' : 'Choose a file to upload.'
  if (!ALLOWED_EMPLOYEE_FILE_TYPES.includes(file.type)) {
    return lang === 'ar' ? 'الملفات المسموح بها: PDF أو JPG أو PNG.' : 'Allowed files: PDF, JPG, or PNG.'
  }
  if (file.size > MAX_EMPLOYEE_FILE_SIZE) {
    return lang === 'ar' ? 'الحد الأقصى لحجم الملف هو 10MB.' : 'Maximum file size is 10MB.'
  }
  return ''
}

export function buildEmployeeDocumentPath(employeeId, docType, fileName) {
  const ext = String(fileName || '').includes('.') ? String(fileName).split('.').pop().toLowerCase() : 'bin'
  const safeType = String(docType || 'other').replace(/[^a-z0-9_-]/gi, '_')
  return `${EMPLOYEE_DOC_BUCKET}/${employeeId}/${safeType}-${Date.now()}.${ext}`
}

export function stripEmployeeDocumentBucket(path) {
  return String(path || '').replace(new RegExp(`^${EMPLOYEE_DOC_BUCKET}/`), '')
}

export function friendlyStorageError(error, lang) {
  const msg = String(error?.message || '')
  if (msg.toLowerCase().includes('bucket') || msg.toLowerCase().includes('not found')) {
    return employeeDocBucketMissingMessage(lang)
  }
  return msg || (lang === 'ar' ? 'تعذر تنفيذ العملية على الملف.' : 'File operation failed.')
}