import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchProviderUsage, fetchSettings, saveSettings } from '../api'
import type { ParamValue, ProviderUsage, SettingDef, SettingsSchema } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onSaved: () => void
  onOpenData: () => void
}

/**
 * Sections that are more than a list of settings. They are spliced into the nav
 * after the named group, so adding one never touches the schema-driven path.
 * Downloaded candles have their own modal and are not one of these.
 */
const CUSTOM_SECTIONS: { name: string; after: string }[] = []

function Field({
  setting,
  value,
  onChange,
}: {
  setting: SettingDef
  value: ParamValue | undefined
  onChange: (value: ParamValue) => void
}) {
  const current = value ?? setting.value
  const id = `setting-${setting.key}`

  const input = () => {
    switch (setting.type) {
      case 'bool':
        return (
          <input
            id={id}
            type="checkbox"
            checked={Boolean(current)}
            onChange={(e) => onChange(e.target.checked)}
          />
        )
      case 'number':
        return (
          <input
            id={id}
            type="number"
            value={String(current ?? '')}
            min={setting.min}
            max={setting.max}
            step={setting.step}
            onChange={(e) => {
              const parsed = Number(e.target.value)
              if (!Number.isNaN(parsed)) onChange(parsed)
            }}
          />
        )
      case 'select':
        return (
          <select id={id} className="select" value={String(current ?? '')} onChange={(e) => onChange(e.target.value)}>
            {(setting.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        )
      case 'password':
        return (
          <input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={String(current ?? '')}
            placeholder={setting.isSet ? `stored ${setting.hint}` : setting.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      default:
        return (
          <input
            id={id}
            type="text"
            value={String(current ?? '')}
            placeholder={setting.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        )
    }
  }

  return (
    <div className={setting.type === 'bool' ? 'field field-inline' : 'field'}>
      <label htmlFor={id}>{setting.label}</label>
      {input()}
      {setting.help && <p className="field-help">{setting.help}</p>}
    </div>
  )
}

export default function SettingsModal({ open, onClose, onSaved, onOpenData }: Props) {
  const [schema, setSchema] = useState<SettingsSchema | null>(null)
  const [edits, setEdits] = useState<Record<string, ParamValue>>({})
  const [section, setSection] = useState<string>('Data provider')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<ProviderUsage | null>(null)
  const [testing, setTesting] = useState(false)

  const load = useCallback(() => {
    fetchSettings()
      .then((next) => {
        setSchema(next)
        setEdits({})
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const sections = useMemo(() => {
    const names = (schema?.groups ?? []).map((group) => group.name)
    const out = [...names]
    for (const custom of CUSTOM_SECTIONS) {
      const at = out.indexOf(custom.after)
      out.splice(at < 0 ? out.length : at + 1, 0, custom.name)
    }
    return out
  }, [schema])

  useEffect(() => {
    if (sections.length && !sections.includes(section)) setSection(sections[0])
  }, [sections, section])

  const dirty = Object.keys(edits).length > 0

  const handleSave = () => {
    if (!dirty) return
    setSaving(true)
    setError(null)
    saveSettings(edits)
      .then((next) => {
        setSchema(next)
        setEdits({})
        onSaved()
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setSaving(false))
  }

  const handleTest = () => {
    setTesting(true)
    setUsage(null)
    // Save first: the key being tested is the one the backend has.
    const before = dirty ? saveSettings(edits).then((next) => setSchema(next)) : Promise.resolve()
    before
      .then(() => {
        setEdits({})
        return fetchProviderUsage()
      })
      .then(setUsage)
      .catch((err: Error) => setUsage({ ok: false, message: err.message }))
      .finally(() => setTesting(false))
  }

  if (!open) return null

  const group = schema?.groups.find((entry) => entry.name === section)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>Settings</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </header>

        <div className="modal-body">
          <nav className="modal-nav">
            {sections.map((name) => (
              <button
                key={name}
                type="button"
                className={name === section ? 'modal-tab active' : 'modal-tab'}
                onClick={() => setSection(name)}
              >
                {name}
              </button>
            ))}
          </nav>

          <div className="modal-pane">
            {error && <div className="panel-error">{error}</div>}

            {(
              <>
                {group?.settings.map((setting) => (
                  <Field
                    key={setting.key}
                    setting={setting}
                    value={edits[setting.key]}
                    onChange={(value) => setEdits((current) => ({ ...current, [setting.key]: value }))}
                  />
                ))}

                {section === 'Data provider' && (
                  <div className="field-actions">
                    <button type="button" className="ghost" onClick={handleTest} disabled={testing}>
                      {testing ? 'Testing…' : 'Test connection'}
                    </button>
                    {usage &&
                      (usage.ok ? (
                        <span className="ok small">
                          Connected · {usage.plan} plan
                          {usage.limit ? ` · ${usage.used}/${usage.limit} credits used today` : ''}
                        </span>
                      ) : (
                        <span className="bad small">{usage.message}</span>
                      ))}
                  </div>
                )}

                {section === 'Data provider' && (
                  <p className="field-help">
                    Downloaded candles, their size on disk and their coverage live in{' '}
                    <button type="button" className="link-button inline" onClick={onOpenData}>
                      Chart data
                    </button>
                    .
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <footer className="modal-foot">
          <span className="dim small" title={schema?.file}>
            Stored on this PC
          </span>
          <div className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="run" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  )
}
