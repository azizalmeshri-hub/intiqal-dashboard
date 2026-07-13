import { supabase } from './supabase'

export async function writeAuditLog({ tableName, rowId, action, before, after, user }) {
  try {
    await supabase.from('audit_log').insert({
      user_id: user?.id || null,
      user_email: user?.email || null,
      table_name: tableName,
      row_id: String(rowId || ''),
      action,
      before: before || null,
      after: after || null,
      ts: new Date().toISOString(),
    })
  } catch (error) {
    // Audit should never block business writes.
    console.warn('Audit insert failed:', error?.message || error)
  }
}
