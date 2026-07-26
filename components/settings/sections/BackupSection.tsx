import { useEffect, useRef, useState } from "react"
import {
  FiCheck, FiCloud, FiDownload, FiEye, FiEyeOff, FiRefreshCw, FiUpload
} from "react-icons/fi"
import { DEFAULT_SETTINGS } from "@neutab/shared/utils/settings"
import type { Language, getTranslations } from "@neutab/shared/utils/i18n"
import {
  applyImportDataToStorage,
  buildBackupPayload as buildBackupPayloadFromStorage,
  cloudPull,
  cloudPush,
  readCloudSyncPrefs,
  readCloudSyncStatus,
  writeCloudSyncStatus,
  writeSecureAuthCode,
  type CloudSyncStatus
} from "~utils/cloudSync"

interface BackupSectionProps {
  t: ReturnType<typeof getTranslations>
  language: Language | undefined
}

/** 备份分区:导入导出 + 云同步配置与手动推拉 */
const BackupSection = ({ t, language }: BackupSectionProps) => {
  const [importStatus, setImportStatus] = useState<{ type: "error" | "success"; message: string } | null>(null)

  // 云同步状态
  const [syncEnabled, setSyncEnabled] = useState(() => localStorage.getItem("syncEnabled") === "true")
  const [syncServerUrl, setSyncServerUrl] = useState(() => localStorage.getItem("syncServerUrl") || "")
  const [syncAuthCode, setSyncAuthCode] = useState("")
  const [isSyncAuthCodeReady, setIsSyncAuthCodeReady] = useState(false)
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(() => localStorage.getItem("autoSyncEnabled") === "true")
  const [lastSyncTime, setLastSyncTime] = useState(() => readCloudSyncStatus().lastSyncTime)
  const [lastSyncStatus, setLastSyncStatus] = useState(() => readCloudSyncStatus().lastSyncStatus)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showAuthCode, setShowAuthCode] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<{ action: "pull" | "push" } | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 持久化云同步设置
  useEffect(() => {
    localStorage.setItem("syncEnabled", String(syncEnabled))
    localStorage.setItem("syncServerUrl", syncServerUrl)
    localStorage.setItem("autoSyncEnabled", String(autoSyncEnabled))
    if (isSyncAuthCodeReady) {
      void writeSecureAuthCode(syncAuthCode)
    }
  }, [syncEnabled, syncServerUrl, syncAuthCode, autoSyncEnabled, isSyncAuthCodeReady])

  // Load auth code from secure storage on mount
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const prefs = await readCloudSyncPrefs()
        if (!cancelled) {
          setSyncAuthCode(prefs.authCode)
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) {
          setIsSyncAuthCodeReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Keep UI in sync with CloudSyncAgent (auto sync) status updates.
  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<CloudSyncStatus>).detail
      if (!detail) return
      setLastSyncTime(detail.timestamp)
      setLastSyncStatus(detail.status)
    }
    window.addEventListener("neutab-cloud-sync-status", onStatus as EventListener)
    return () => window.removeEventListener("neutab-cloud-sync-status", onStatus as EventListener)
  }, [])

  /** 执行备份导出 */
  const handleExport = async () => {
    const payload = await buildBackupPayloadFromStorage(language || DEFAULT_SETTINGS.language)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
    link.href = url
    link.download = `homepage-backup-${timestamp}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const data = parsed?.data ?? parsed
      await applyImportDataToStorage(data, language || DEFAULT_SETTINGS.language)
      setImportStatus({ type: "success", message: t.importSuccess })
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (error) {
      console.error("Import failed:", error)
      setImportStatus({ type: "error", message: t.importFailed })
    }
  }

  const handlePull = async () => {
    if (!syncServerUrl || !syncAuthCode) return
    setIsSyncing(true)
    try {
      await cloudPull(syncServerUrl, syncAuthCode, language || DEFAULT_SETTINGS.language)
      writeCloudSyncStatus({ action: "pull", status: "success", timestamp: new Date().toISOString() })
    } catch {
      writeCloudSyncStatus({ action: "pull", status: "failed", timestamp: new Date().toISOString() })
    } finally {
      setIsSyncing(false)
    }
  }

  const handlePush = async () => {
    if (!syncServerUrl || !syncAuthCode) return
    setIsSyncing(true)
    try {
      await cloudPush(syncServerUrl, syncAuthCode, language || DEFAULT_SETTINGS.language)
      writeCloudSyncStatus({ action: "push", status: "success", timestamp: new Date().toISOString() })
    } catch {
      writeCloudSyncStatus({ action: "push", status: "failed", timestamp: new Date().toISOString() })
    } finally {
      setIsSyncing(false)
    }
  }

  const handleConfirmAction = () => {
    if (!confirmDialog) return
    if (confirmDialog.action === "pull") {
      handlePull()
    } else {
      handlePush()
    }
    setConfirmDialog(null)
  }

  return (
    <section className="settings-section" key="backup">
      <h3>{t.dataBackup}</h3>

      {/* 导出/导入磁贴 */}
      <div className="backup-grid">
        <button type="button" className="backup-card" onClick={handleExport}>
          <div className="backup-icon icon-export">
            <FiDownload size={28} />
          </div>
          <div>
            <h4>{t.exportConfig}</h4>
            <p>{t.exportConfigDesc}</p>
          </div>
        </button>

        <label className="backup-card">
          <div className="backup-icon icon-import">
            <FiUpload size={28} />
          </div>
          <div>
            <h4>{t.importConfig}</h4>
            <p>{t.importConfigDesc}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            accept="application/json"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                setImportStatus(null)
                handleImport(file)
              }
            }}
          />
        </label>
      </div>

      {/* 导入状态反馈 */}
      {importStatus && (
        <div className={`backup-status ${importStatus.type}`}>
          {importStatus.type === "success" && <FiCheck size={16} />}
          {importStatus.message}
        </div>
      )}

      {/* 云同步区域 */}
      <div className="settings-island sync-section">
        <label className="island-row">
          <div className="row-left">
            <div className="row-icon icon-sync">
              <FiCloud size={18} />
            </div>
            <div className="row-text">
              <span className="row-title">{t.cloudSync}</span>
              <span className="row-desc">{t.cloudSyncDesc}</span>
            </div>
          </div>
          <div className="toggle-switch">
            <input
              type="checkbox"
              checked={syncEnabled}
              onChange={() => setSyncEnabled(!syncEnabled)}
            />
            <span className="toggle-slider"></span>
          </div>
        </label>

        {syncEnabled && (
          <>
            <div className="settings-field">
              <label>{t.syncServerUrl}</label>
              <input
                type="text"
                className="settings-input soft-in"
                placeholder="https://neutab.example.com"
                value={syncServerUrl}
                onChange={(e) => setSyncServerUrl(e.target.value)}
              />
            </div>

            <div className="settings-field">
              <label>{t.syncAuthCode}</label>
              <div className="input-with-toggle">
                <input
                  type={showAuthCode ? "text" : "password"}
                  className="settings-input soft-in"
                  placeholder="••••••••"
                  value={syncAuthCode}
                  onChange={(e) => setSyncAuthCode(e.target.value)}
                />
                <button
                  type="button"
                  className="input-toggle-btn"
                  onClick={() => setShowAuthCode(!showAuthCode)}
                  aria-label={showAuthCode ? "Hide" : "Show"}
                >
                  {showAuthCode ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                </button>
              </div>
            </div>

            <label className="island-row">
              <div className="row-left">
                <div className="row-icon icon-auto-sync">
                  <FiRefreshCw size={18} />
                </div>
                <div className="row-text">
                  <span className="row-title">{t.autoSync}</span>
                  <span className="row-desc">{t.autoSyncDesc}</span>
                </div>
              </div>
              <div className="toggle-switch">
                <input
                  type="checkbox"
                  checked={autoSyncEnabled}
                  onChange={() => setAutoSyncEnabled(!autoSyncEnabled)}
                />
                <span className="toggle-slider"></span>
              </div>
            </label>

            <div className="sync-actions">
              <button
                type="button"
                className="sync-btn soft-out"
                onClick={() => setConfirmDialog({ action: "pull" })}
                disabled={isSyncing || !syncServerUrl || !syncAuthCode}
              >
                <FiDownload size={16} />
                <span>{t.manualPull}</span>
              </button>
              <button
                type="button"
                className="sync-btn soft-out"
                onClick={() => setConfirmDialog({ action: "push" })}
                disabled={isSyncing || !syncServerUrl || !syncAuthCode}
              >
                <FiUpload size={16} />
                <span>{t.manualPush}</span>
              </button>
            </div>

            <div className="sync-status-row">
              <span className="sync-status-label">{t.lastSyncTime}:</span>
              <span className={`sync-status-value ${lastSyncStatus}`}>
                {isSyncing
                  ? t.syncing
                  : lastSyncTime
                    ? `${new Date(lastSyncTime).toLocaleString()} ${lastSyncStatus === "success" ? "✓" : lastSyncStatus === "failed" ? "✗" : ""}`
                    : t.neverSynced}
              </span>
            </div>
          </>
        )}
      </div>

      {/* 确认对话框 */}
      {confirmDialog && (
        <div className="confirm-dialog-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="confirm-dialog soft-out" role="dialog" aria-modal="true" aria-labelledby="cloud-sync-confirm-title" onClick={(e) => e.stopPropagation()}>
            <h4 id="cloud-sync-confirm-title" className="confirm-dialog-title">{t.confirmOverwriteTitle}</h4>
            <p className="confirm-dialog-message">{t.confirmOverwrite}</p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="confirm-dialog-btn cancel soft-out"
                onClick={() => setConfirmDialog(null)}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                className="confirm-dialog-btn confirm soft-out"
                onClick={handleConfirmAction}
              >
                {t.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default BackupSection
