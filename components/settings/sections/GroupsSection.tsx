import { useEffect, useState } from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { FiCheck, FiChevronDown, FiChevronUp, FiPlus, FiTrash2, FiX } from "react-icons/fi"
import type { QuickLaunchGroup } from "@neutab/shared/types/quickLaunch"
import { DEFAULT_GROUPS } from "@neutab/shared/utils/quickLaunchDefaults"
import type { getTranslations } from "@neutab/shared/utils/i18n"
import { GROUPS_KEY, localExtStorage } from "~components/quick-launch/quickLaunchStorage"
import { handleCommitOnEnter } from "~components/settings/sectionUtils"

interface GroupsSectionProps {
  t: ReturnType<typeof getTranslations>
}

/** 分组分区:新增、重命名、排序、删除分组 */
const GroupsSection = ({ t }: GroupsSectionProps) => {
  const [groups, setGroups] = useStorage<QuickLaunchGroup[]>(
    { key: GROUPS_KEY, instance: localExtStorage },
    DEFAULT_GROUPS
  )

  const [groupNameDrafts, setGroupNameDrafts] = useState<Record<string, string>>({})
  const [newGroupName, setNewGroupName] = useState("")
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null)

  const safeGroups = groups?.length ? groups : DEFAULT_GROUPS

  /** 同步分组名称预览状态 */
  useEffect(() => {
    setGroupNameDrafts((prev) => {
      const next = { ...prev }
      const ids = new Set(safeGroups.map((group) => group.id))

      safeGroups.forEach((group) => {
        const currentDraft = prev[group.id]
        const actualValue = group.name

        if (currentDraft === undefined) {
          // 首次初始化
          next[group.id] = actualValue
        } else if (currentDraft !== actualValue) {
          // draft 与实际值不同:用户编辑中不覆盖;仅 storage 加载完成(Default → 真实名)时同步
          const isStorageLoaded = currentDraft === "Default" && actualValue !== "Default"
          if (isStorageLoaded) {
            next[group.id] = actualValue
          }
        }
      })

      // 清理已删除分组的 draft
      Object.keys(next).forEach((id) => {
        if (!ids.has(id)) {
          delete next[id]
        }
      })

      return next
    })
  }, [safeGroups])

  /** 新增分组 */
  const addGroup = () => {
    const name = newGroupName === "" ? `${t.groupPrefix} ${safeGroups.length + 1}` : newGroupName
    const nextGroup: QuickLaunchGroup = {
      id: Date.now().toString(),
      name,
      apps: []
    }
    setGroups([...(safeGroups || []), nextGroup])
    setNewGroupName("")
  }

  const updateGroupName = (groupId: string, name: string) => {
    setGroupNameDrafts((prev) => ({ ...prev, [groupId]: name }))
  }

  /** 提交分组名称更改(允许空白名) */
  const commitGroupName = (groupId: string, name: string) => {
    setGroupNameDrafts((prev) => ({ ...prev, [groupId]: name }))
    setGroups((prevGroups) => {
      const current = prevGroups?.length ? prevGroups : DEFAULT_GROUPS
      return current.map((group) => (group.id === groupId ? { ...group, name } : group))
    })
  }

  const moveGroup = (index: number, direction: number) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= safeGroups.length) return
    const nextGroups = [...safeGroups]
    const [item] = nextGroups.splice(index, 1)
    nextGroups.splice(targetIndex, 0, item)
    setGroups(nextGroups)
  }

  const executeDeleteGroup = (groupId: string) => {
    setGroups(safeGroups.filter((g) => g.id !== groupId))
    setGroupToDelete(null)
  }

  return (
    <section className="settings-section" key="groups">
      <h3>{t.groupManagement}</h3>

      {/* 分组添加区域 */}
      <div className="group-add">
        <input
          type="text"
          className="settings-input soft-in"
          placeholder={t.newGroupName}
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              addGroup()
            }
          }}
        />
        <button type="button" className="settings-btn" onClick={addGroup}>
          <FiPlus size={16} /> {t.add}
        </button>
      </div>

      {/* 分组列表:支持排序、快速编辑名称、二次确认删除 */}
      <div className="group-list">
        {safeGroups.map((group, index) => (
          <div key={group.id} className="group-row">
            <div className="group-move">
              <button
                type="button"
                className="icon-btn"
                disabled={index === 0}
                onClick={() => moveGroup(index, -1)}
                aria-label={t.moveUp}>
                <FiChevronUp size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={index === safeGroups.length - 1}
                onClick={() => moveGroup(index, 1)}
                aria-label={t.moveDown}>
                <FiChevronDown size={14} />
              </button>
            </div>
            <input
              type="text"
              className="settings-input soft-in"
              value={groupNameDrafts[group.id] ?? group.name}
              onChange={(e) => updateGroupName(group.id, e.target.value)}
              onBlur={(e) => commitGroupName(group.id, e.target.value)}
              onKeyDown={(event) =>
                handleCommitOnEnter(event, () => commitGroupName(group.id, event.currentTarget.value))
              }
            />
            {groupToDelete === group.id ? (
              <div className="group-confirm-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => executeDeleteGroup(group.id)}
                  aria-label={t.confirmDelete}
                  style={{ color: "#e74c3c" }}
                >
                  <FiCheck size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn cancel"
                  onClick={() => setGroupToDelete(null)}
                  aria-label={t.cancelDelete}
                >
                  <FiX size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="icon-btn delete"
                onClick={() => setGroupToDelete(group.id)}
                disabled={safeGroups.length <= 1} // 至少保留一个分组
                aria-label={t.deleteGroup}>
                <FiTrash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export default GroupsSection
