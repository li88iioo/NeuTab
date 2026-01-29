import { useState, useEffect, useRef } from "react"

/**
 * RangeInput 组件属性
 */
interface RangeInputProps {
  /** 字段标签 */
  label: React.ReactNode
  /** 外部绑定的数值 */
  value: number
  /** 最小值 */
  min: number
  /** 最大值 */
  max: number
  /** 步长 */
  step: number
  /** 数值单位 (如 px, rem, %) */
  unit?: string
  /** 数值实时变化回调 (用于预览) */
  onChange: (value: number) => void
  /** 数值最终确定回调 (用于持久化) */
  onCommit: (value: number) => void
}

/**
 * 范围滑块输入组件
 * @description 
 * 1. 采用“双缓冲”状态设计：`localValue` 提供 60fps 的极速视觉响应，`onCommit` 负责最终存储。
 * 2. 使用 `requestAnimationFrame` (RAF) 对 `onChange` 进行节流，避免高频触发重重的父组件重绘或网络请求。
 */
const RangeInput = ({
  label,
  value,
  min,
  max,
  step,
  unit = "px",
  onChange,
  onCommit
}: RangeInputProps) => {
  /** 本地状态用于即时视觉反馈 (60fps) */
  const [localValue, setLocalValue] = useState(value)
  /** RAF 句柄，用于节流处理 */
  const rafRef = useRef<number | null>(null)
  /** 标记用户是否正处于拖拽状态，防止外部 value 更新导致的抖动 */
  const isDraggingRef = useRef(false)
  /** 防止重复提交（mouseUp/touchEnd/blur 可能连续触发） */
  const lastCommittedRef = useRef(value)

  // 同步外部 value 变化（仅在非拖拽时同步）
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value)
      lastCommittedRef.current = value
    }
  }, [value])

  /** 解析并校验输入值为合法数字 */
  const parseValue = (val: string) => {
    const numeric = Number(val)
    if (Number.isNaN(numeric)) return min
    return Math.min(max, Math.max(min, numeric))
  }

  /** 处理滑块变动 */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseValue(e.target.value)
    setLocalValue(newValue)
    isDraggingRef.current = true

    // RAF 节流：合并高频更新，每帧最多触发一次 onChange 预览更新
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
    rafRef.current = requestAnimationFrame(() => {
      onChange(newValue)
      rafRef.current = null
    })
  }

  /** 处理数值提交（拖拽结束或失去焦点） */
  const handleCommit = () => {
    isDraggingRef.current = false
    // 取消尚未执行的节流任务
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // 避免重复写入 storage（也减少云同步噪音）
    if (localValue === lastCommittedRef.current) return
    lastCommittedRef.current = localValue
    onCommit(localValue)
  }

  // 组件卸载时清理 RAF
  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  return (
    <div className="settings-field">
      <label>
        {label} ({localValue}{unit})
      </label>
      <input
        type="range"
        className="settings-range"
        min={min}
        max={max}
        step={step}
        value={localValue}
        onChange={handleChange}
        onMouseUp={handleCommit}
        onTouchEnd={handleCommit}
        onKeyUp={handleCommit}
        onBlur={handleCommit}
      />
    </div>
  )
}

export default RangeInput
