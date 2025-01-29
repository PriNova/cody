import type { CSSProperties } from 'react'
import { forwardRef, memo } from 'react'
import Markdown from 'react-markdown'
import { defaultUrlTransform } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { WorkflowToExtension } from '../services/WorkflowProtocol'

const ALLOWED_URI_REGEXP = /^((https?|file|vscode):\/\/[^\s#$./?].\S*$|(command:_?cody.*))/i

function wrapLinksWithCodyOpenCommand(url: string | undefined): string | undefined {
    if (url === undefined) {
        return undefined
    }
    const transformedURL = defaultUrlTransform(url)
    if (!ALLOWED_URI_REGEXP.test(transformedURL)) {
        return undefined
    }
    const encodedURL = encodeURIComponent(JSON.stringify(transformedURL))
    const commandURL = `command:_cody.vscode.open?${encodedURL}`
    return commandURL
}

interface SimpleMarkdownProps {
    handlePostMessage: (message: WorkflowToExtension) => void
    className?: string
    children: string
    style?: CSSProperties
}

export const SimpleMarkdown = memo(
    forwardRef<HTMLDivElement, SimpleMarkdownProps>(
        ({ handlePostMessage, className, children, style }, ref) => {
            return (
                <div ref={ref} style={{ ...style, userSelect: 'text' }} className={className}>
                    <Markdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeSanitize]}
                        components={{
                            a: ({ href, children, ...props }) => (
                                <a
                                    href={href ? wrapLinksWithCodyOpenCommand(href) : undefined}
                                    onClick={event => {
                                        event.preventDefault()
                                        if (href) {
                                            handlePostMessage({
                                                type: 'open_external_link',
                                                url: href,
                                            } as WorkflowToExtension)
                                        }
                                    }}
                                    {...props}
                                >
                                    {children}
                                </a>
                            ),
                        }}
                    >
                        {children}
                    </Markdown>
                </div>
            )
        }
    )
)

SimpleMarkdown.displayName = 'SimpleMarkdown'
