/**
 * TypeScript type declarations for the HTML inert attribute
 * @see https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/inert
 */

declare module 'react' {
  interface HTMLAttributes<T> {
    /**
     * The inert attribute makes the browser ignore user input events for the element,
     * including focus events and events from assistive technologies.
     *
     * When an element is inert:
     * - It cannot be focused
     * - It is hidden from assistive technology
     * - Click events are ignored
     * - Text selection is disabled
     *
     * @see https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/inert
     */
    inert?: '' | undefined
  }
}

export {}
