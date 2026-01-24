import React, { Component, ErrorInfo, ReactNode } from "react"

/**
 * ErrorBoundary 组件属性
 */
interface Props {
  /** 子组件（受保护的内容） */
  children: ReactNode
  /** 可选的自定义错误 UI，若不提供则使用内置 neumorphic 风格 */
  fallback?: ReactNode
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

  render() {
    if (this.state.hasError) {
      // 优先使用传入的自定义 fallback
      if (this.props.fallback) {
        return this.props.fallback
      }

      // 默认的 Neumorphic 错误提示 UI
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "20px",
            textAlign: "center",
            background: "var(--bg)",
            color: "var(--txt-primary)"
          }}>
          <div
            style={{
              maxWidth: "500px",
              padding: "40px",
              borderRadius: "20px",
              background: "var(--bg)",
              boxShadow: "8px 8px 16px var(--shadow-dark), -8px -8px 16px var(--shadow-light)"
            }}>
            <h1 style={{ fontSize: "2rem", marginBottom: "16px", fontWeight: 800 }}>
              😕 出错了
            </h1>
            <p style={{ marginBottom: "24px", color: "var(--txt-secondary)", lineHeight: 1.6 }}>
              页面遇到了一个错误，请尝试刷新页面。
            </p>
            {/* 错误详情展示（默认折叠） */}
            {this.state.error && (
              <details style={{ marginBottom: "24px", textAlign: "left" }}>
                <summary
                  style={{
                    cursor: "pointer",
                    color: "var(--txt-secondary)",
                    fontSize: "0.9rem",
                    marginBottom: "8px"
                  }}>
                  查看错误详情
                </summary>
                <pre
                  style={{
                    background: "rgba(0,0,0,0.05)",
                    padding: "12px",
                    borderRadius: "8px",
                    fontSize: "0.8rem",
                    overflow: "auto",
                    color: "var(--txt-secondary)"
                  }}>
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
            <button
              onClick={this.handleReset}
              style={{
                padding: "12px 24px",
                borderRadius: "12px",
                border: "none",
                background: "var(--accent)",
                color: "white",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "1rem"
              }}>
              刷新页面
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
