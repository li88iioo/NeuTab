import React, { Component, ErrorInfo, ReactNode } from "react"
import { DEFAULT_LANGUAGE, getTranslations, type Language } from "@neutab/shared/utils/i18n"
import "./ErrorBoundary.css"

/**
 * ErrorBoundary 组件属性
 */
interface Props {
  /** 子组件（受保护的内容） */
  children: ReactNode
  /** 可选的自定义错误 UI，若不提供则使用内置 neumorphic 风格 */
  fallback?: ReactNode
  /** 当前语言 */
  language?: Language
}

/**
 * ErrorBoundary 状态
 */
interface State {
  /** 是否发生错误 */
  hasError: boolean
  /** 捕获到的错误对象 */
  error: Error | null
}

/**
 * 错误边界组件
 * @description 
 * 用于捕获其子组件树中发生的任何 JavaScript 错误，记录错误日志，
 * 并展示一个优雅的退化 UI (Fallback UI)，防止整个扩展程序崩溃。
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null
    }
  }

  /**
   * 当子组件抛出错误时调用
   * @param error 抛出的错误
   * @returns 更新后的状态对象
   */
  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error
    }
  }

  /**
   * 记录错误信息
   * @param error 抛出的错误
   * @param errorInfo 包含有关组件堆栈的信息
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo)
  }

  /**
   * 处理重置逻辑
   * @description 尝试恢复组件状态并强制刷新页面，以解决临时性冲突。
   */
  handleReset = () => {
    this.setState({
      hasError: false,
      error: null
    })
    window.location.reload()
  }

  private resolveLanguage(): Language {
    const { language } = this.props
    if (language === "zh" || language === "en") return language
    try {
      const cached = localStorage.getItem("lang_cache")
      if (cached === "zh" || cached === "en") return cached
    } catch {
      // ignore
    }
    return DEFAULT_LANGUAGE
  }

  render() {
    if (this.state.hasError) {
      // 优先使用传入的自定义 fallback
      if (this.props.fallback) {
        return this.props.fallback
      }

      const t = getTranslations(this.resolveLanguage())

      // 默认的 Neumorphic 错误提示 UI
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <h1 className="error-boundary-title">
              {t.errorTitle}
            </h1>
            <p className="error-boundary-description">
              {t.errorDescription}
            </p>
            {/* 错误详情展示（默认折叠） */}
            {this.state.error && (
              <details className="error-boundary-details">
                <summary className="error-boundary-summary">
                  {t.errorDetails}
                </summary>
                <pre className="error-boundary-stack">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
            <button
              onClick={this.handleReset}
              className="error-boundary-button">
              {t.errorRefresh}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
