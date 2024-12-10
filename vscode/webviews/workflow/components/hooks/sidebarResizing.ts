import { useCallback, useEffect, useState } from 'react'

/**
 * A custom React hook that provides functionality for resizing a sidebar component.
 *
 * @param initialWidth - The initial width of the sidebar, defaults to 256.
 * @param minWidth - The minimum width the sidebar can be resized to, defaults to 200.
 * @param maxWidth - The maximum width the sidebar can be resized to, defaults to 600.
 * @returns An object with the following properties:
 *   - sidebarWidth: The current width of the sidebar.
 *   - handleMouseDown: A function to be called when the user starts resizing the sidebar.
 */
export const useSidebarResize = (initialWidth = 256, minWidth = 200, maxWidth = 600) => {
    const [sidebarWidth, setSidebarWidth] = useState(initialWidth)
    const [isResizing, setIsResizing] = useState(false)
    const [startX, setStartX] = useState(0)
    const [startWidth, setStartWidth] = useState(0)

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            setIsResizing(true)
            setStartX(e.clientX)
            setStartWidth(sidebarWidth)
            e.preventDefault()
        },
        [sidebarWidth]
    )

    const handleMouseMove = useCallback(
        (e: MouseEvent) => {
            if (!isResizing) return
            const delta = e.clientX - startX
            const newWidth = Math.min(Math.max(startWidth + delta, minWidth), maxWidth)
            setSidebarWidth(newWidth)
        },
        [isResizing, startX, startWidth, minWidth, maxWidth]
    )

    const handleMouseUp = useCallback(() => {
        setIsResizing(false)
    }, [])

    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isResizing, handleMouseMove, handleMouseUp])

    return {
        sidebarWidth,
        handleMouseDown,
    }
}

/**
 * useRightSidebarResize is a React hook that provides functionality for resizing the right sidebar in a user interface.
 * It returns the current width of the right sidebar and a function to handle the start of a resize interaction.
 *
 * @param initialWidth - The initial width of the right sidebar, defaults to 256.
 * @param minWidth - The minimum allowed width for the right sidebar, defaults to 200.
 * @param maxWidth - The maximum allowed width for the right sidebar, defaults to 800.
 * @returns An object with the following properties:
 *   - rightSidebarWidth: The current width of the right sidebar.
 *   - handleMouseDown: A function to be called when the user starts resizing the sidebar.
 */
export const useRightSidebarResize = (initialWidth = 256, minWidth = 200, maxWidth = 800) => {
    const [rightSidebarWidth, setRightSidebarWidth] = useState(initialWidth)
    const [isResizing, setIsResizing] = useState(false)
    const [startX, setStartX] = useState(0)
    const [startWidth, setStartWidth] = useState(0)

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            setIsResizing(true)
            setStartX(e.clientX)
            setStartWidth(rightSidebarWidth)
            e.preventDefault()
        },
        [rightSidebarWidth]
    )

    const handleMouseMove = useCallback(
        (e: MouseEvent) => {
            if (!isResizing) return
            const delta = startX - e.clientX
            const newWidth = Math.min(Math.max(startWidth + delta, minWidth), maxWidth)
            setRightSidebarWidth(newWidth)
        },
        [isResizing, startX, startWidth, minWidth, maxWidth]
    )

    const handleMouseUp = useCallback(() => {
        setIsResizing(false)
    }, [])

    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isResizing, handleMouseMove, handleMouseUp])

    return {
        rightSidebarWidth,
        handleMouseDown,
    }
}
