import type React from 'react'
import type { CSSProperties } from 'react'
import Markdown from 'react-markdown'
import { defaultUrlTransform } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { WorkflowToExtension } from '../services/WorkflowProtocol'

/**
 * Supported URIs to render as links in outputted markdown.
 * - https?: Web
 * - file: local file scheme
 * - vscode: VS Code URL scheme (open in editor)
 * - command:cody. VS Code command scheme for cody (run command)
 * {@link CODY_PASSTHROUGH_VSCODE_OPEN_COMMAND_ID}
 */
const ALLOWED_URI_REGEXP = /^((https?|file|vscode):\/\/[^\s#$./?].\S*$|(command:_?cody.*))/i

function wrapLinksWithCodyOpenCommand(url: string | undefined): string | undefined {
    // Modified to accept string | undefined
    if (url === undefined) {
        // Handle undefined url input
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

export const SimpleMarkdown: React.FC<SimpleMarkdownProps> = ({
    handlePostMessage,
    className,
    children,
    style,
}) => {
    return (
        <div style={style} className={className}>
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
