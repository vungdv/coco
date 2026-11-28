// Voice commands in Supabase (spec v3 §5): insert, read own, dismiss. RLS and column grants limit the rest.
import { liveChannel, supabase } from './supabase'
import { withTimeout } from './orders'
import type { VoiceCommand, VoiceRepo } from './voice'

const COLUMNS = 'id,transcript,delivery_date,status,result'

export const supabaseVoiceRepo: VoiceRepo = {
  async send(transcript, delivery_date) {
    const { data, error } = await withTimeout(
      supabase!.from('voice_commands').insert({ transcript, delivery_date }).select(COLUMNS).single())
    if (error) throw error
    return data as VoiceCommand
  },
  async get(ids) {
    const { data, error } = await withTimeout(supabase!.from('voice_commands').select(COLUMNS).in('id', ids))
    if (error) throw error
    return data as VoiceCommand[]
  },
  async dismiss(id) {
    const { data, error } = await withTimeout(
      supabase!.from('voice_commands').update({ status: 'dismissed' }).eq('id', id).select('id'))
    if (error) throw error
    return data.length > 0
  },
  subscribe(onChange) {
    return liveChannel('voice_commands', ch => ch.on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'voice_commands' }, e => onChange(e.new as VoiceCommand)))
  },
}
