import { memo, useEffect, useState } from "react"
import type { Language } from "@neutab/shared/utils/i18n"
import "./Clock.css"

/**
 * 时钟组件属性接口
 */
export type ClockProps = {
    /** 是否显示秒钟 */
    showSeconds?: boolean
    /** 是否显示日期 */
    showDate?: boolean
    /** 当前使用的语言，影响日期格式化 */
    language?: Language
}

/**
 * 动态时钟组件
 * @description 实时显示当前时间（时:分[:秒]）和日期。
 * 使用 requestAnimationFrame 或精准定时器同步系统时间，并处理了多语言（中/英）显示。
 */
const Clock = memo(function Clock({ showSeconds = false, showDate = true, language }: ClockProps) {
    // ---------------------------------------------------------------------------
    // 状态管理
    // ---------------------------------------------------------------------------

    /** 
     * 当前时间对象 
     * @description 初始化为系统当前时间，用于后续所有格式化计算。
     */
    const [date, setDate] = useState(() => new Date())

    /**
     * Effect: 定时器同步
     * @description 建立一个自适应的定时器，确保秒钟跳动与系统时钟同步。
     */
    useEffect(() => {
        let timerId: number | null = null

        const tick = () => {
            setDate(new Date())
            const now = Date.now()

            // If seconds are hidden, update only on minute boundaries to avoid needless re-renders.
            const step = showSeconds ? 1000 : 60_000
            const next = step - (now % step)
            timerId = window.setTimeout(tick, next)
        }

        // 立即执行第一次，避免初始渲染留白
        tick()

        return () => {
            if (timerId !== null) window.clearTimeout(timerId)
        }
    }, [showSeconds])

    // ---------------------------------------------------------------------------
    // 格式化辅助 (Format Helpers)
    // ---------------------------------------------------------------------------
    const h = String(date.getHours()).padStart(2, "0")
    const m = String(date.getMinutes()).padStart(2, "0")
    const s = String(date.getSeconds()).padStart(2, "0")

    /**
     * 解析最终使用的语言
     * @description 优先级：Props 传入 > 浏览器 navigator.language > 默认 'zh'
     */
    const resolvedLang: Language = (() => {
        if (language === "zh" || language === "en") return language
        if (typeof navigator === "undefined") return "zh"
        return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"
    })()

    const isZh = resolvedLang === "zh"

    // 中文日期格式化
    const weekdayZh = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()]
    const monthDayZh = `${date.getMonth() + 1}月${date.getDate()}日`

    // 英文日期格式化
    // 使用固定的 'en' 本地化参数以保证显示一致性
    const monthDayEn = date.toLocaleDateString("en", { month: "short", day: "numeric" })
    const weekdayEn = date.toLocaleDateString("en", { weekday: "short" })

    const monthDay = isZh ? monthDayZh : monthDayEn
    const weekday = isZh ? weekdayZh : weekdayEn

    return (
        <div className="clock-container">
            {/* 时间显示区域：使用 suppressHydrationWarning 避免服务端/客户端时间差导致的 Hydration 警告 */}
            <div className="time-display" suppressHydrationWarning>
                <div className="time-unit h">{h}</div>
                <div className="time-sep">:</div>
                <div className="time-unit m">{m}</div>

                {showSeconds && (
                    <>
                        <div className="time-sep">:</div>
                        <div className="time-unit s">{s}</div>
                    </>
                )}
            </div>

            {showDate && (
                <div className="date-display" suppressHydrationWarning>
                    <span className="date-md">{monthDay}</span>
                    {/* 日期间隔点：通过 CSS 控制样式 */}
                    <span className="date-sep" aria-hidden="true" />
                    <span className="date-wd">{weekday}</span>
                </div>
            )}
        </div>
    )
})

export default Clock
