import * as vscode from 'vscode'
import type { WorkflowNodes } from '../../webviews/workflow/components/nodes/Nodes'
import { writeToCodyJSON } from '../commands/utils/config-file'
import { migrateWorkflowData } from './workflow-migration'

export const WORKFLOW_VERSION = '1.1.0'
export const CODY_NODES_DIR = '.sourcegraph/nodes'
export const CODY_WORKFLOWS_DIR = '.sourcegraph/workflows'

/**
 * Handles the workflow saving process by displaying a save dialog to the user, allowing them to select a location to save the workflow file.
 *
 * @param data - The workflow data to be saved.
 * @returns A Promise that resolves when the workflow file has been successfully saved, or rejects if an error occurs.
 */
export async function handleWorkflowSave(data: any): Promise<string | undefined> {
    const workspaceRootFsPath = vscode.workspace.workspaceFolders?.[0]?.uri?.path
    const defaultFilePath = workspaceRootFsPath
        ? vscode.Uri.joinPath(
              vscode.Uri.file(workspaceRootFsPath),
              CODY_WORKFLOWS_DIR + '/workflow.json'
          )
        : vscode.Uri.file('workflow.json')
    const result = await vscode.window.showSaveDialog({
        defaultUri: defaultFilePath,
        filters: {
            'Workflow Files': ['json'],
        },
        title: 'Save Workflow',
    })
    if (result) {
        try {
            await writeToCodyJSON(result, { ...data, version: WORKFLOW_VERSION })
            void vscode.window.showInformationMessage('Workflow saved successfully!')
            // Return the filename for panel title update
            return result.path
                .split('/')
                .pop()
                ?.replace(/\.json$/, '')
        } catch (error) {
            void vscode.window.showErrorMessage(`Failed to save workflow: ${error}`)
        }
    }
    return undefined
}

/**
 * Handles the workflow loading process by displaying an open dialog to the user, allowing them to select a workflow file.
 *
 * @returns The loaded workflow data, or `null` if the user cancels the operation or an error occurs.
 */
export async function handleWorkflowLoad(): Promise<any> {
    const workspaceRootFsPath = vscode.workspace.workspaceFolders?.[0]?.uri?.path
    const defaultFilePath = workspaceRootFsPath
        ? vscode.Uri.joinPath(vscode.Uri.file(workspaceRootFsPath), CODY_WORKFLOWS_DIR)
        : vscode.Uri.file('workflow.json')

    const result = await vscode.window.showOpenDialog({
        defaultUri: defaultFilePath,
        canSelectMany: false,
        filters: {
            'Workflow Files': ['json'],
        },
        title: 'Load Workflow',
    })

    if (result?.[0]) {
        try {
            const content = await vscode.workspace.fs.readFile(result[0])
            const rawData = JSON.parse(content.toString())
            const data = migrateWorkflowData(rawData)
            void vscode.window.showInformationMessage('Workflow loaded successfully!')
            // Extract the filename without extension
            const filename = result[0].path
                .split('/')
                .pop()
                ?.replace(/\.json$/, '')

            return { data, filename }
        } catch (error) {
            void vscode.window.showErrorMessage(`Failed to load workflow: ${error}`)
            return []
        }
    }
    return []
}

/**
 * Retrieves an array of custom workflow nodes from the `.cody/nodes` directory in the current workspace.
 *
 * This function ensures the `.cody/nodes` directory exists, and then reads all the JSON files in that directory,
 * parsing them as `WorkflowNodes` objects and returning them in an array.
 *
 * If the `.cody/nodes` directory does not exist, or if there are any errors loading the custom nodes, the function
 * will return an empty array and log the errors.
 *
 * @returns An array of `WorkflowNodes` objects representing the custom workflow nodes.
 */
export async function getCustomNodes(): Promise<WorkflowNodes[]> {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace found.')
            return []
        }
        const nodesDirUri = vscode.Uri.joinPath(workspaceRoot, CODY_NODES_DIR)
        try {
            // Ensure the directory exists. If it doesn't, return an empty array.
            await vscode.workspace.fs.createDirectory(nodesDirUri)
        } catch (e: any) {
            if (e.code !== 'FileExists') {
                console.warn(`Directory ${CODY_NODES_DIR} does not exist.`)
                return []
            }
        }

        const files = await vscode.workspace.fs.readDirectory(nodesDirUri)
        const nodes: WorkflowNodes[] = []

        for (const [filename, fileType] of files) {
            if (fileType === vscode.FileType.File && filename.endsWith('.json')) {
                try {
                    const fileUri = vscode.Uri.joinPath(nodesDirUri, filename)
                    const fileData = await vscode.workspace.fs.readFile(fileUri)
                    const node = JSON.parse(fileData.toString()) as WorkflowNodes
                    nodes.push(node)
                } catch (error: any) {
                    console.error(`Failed to load custom node "${filename}": ${error.message}`)
                    vscode.window.showErrorMessage(
                        `Failed to load custom node "${filename}": ${error.message}`
                    )
                }
            }
        }

        return nodes
    } catch (error: any) {
        console.error(`Failed to load custom nodes: ${error.message}`)
        vscode.window.showErrorMessage(`Failed to load custom nodes: ${error.message}`)
        return []
    }
}

/**
 * Saves a custom workflow node to the `.cody/nodes` directory.
 *
 * If the `.cody/nodes` directory does not exist, it will be created. The node is saved as a JSON file with the
 * sanitized title of the node as the filename.
 *
 * @param node - The `WorkflowNodes` object to be saved.
 * @returns A Promise that resolves when the node has been saved successfully.
 */
export async function saveCustomNodes(node: WorkflowNodes): Promise<void> {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace found.')
            return
        }
        const nodesDirUri = vscode.Uri.joinPath(workspaceRoot, CODY_NODES_DIR)
        try {
            await vscode.workspace.fs.createDirectory(nodesDirUri)
        } catch (e: any) {
            if (e.code !== 'FileExists') {
                vscode.window.showErrorMessage(`Failed to create directory: ${e.message}`)
                return
            }
        }

        const filename = `${sanitizeFilename(node.data.title)}.json`
        const fileUri = vscode.Uri.joinPath(nodesDirUri, filename)
        const { id, ...nodeToSave } = node
        await writeToCodyJSON(fileUri, nodeToSave)
        vscode.window.showInformationMessage(`Custom node "${node.data.title}" saved successfully.`)
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to save custom node: ${error.message}`)
    }
}

/**
 * Deletes a custom workflow node from the `.cody/nodes` directory.
 *
 * The function first checks if the workspace has a valid root directory, and then displays a warning message to confirm the deletion of the custom node. If the user confirms the deletion, the function finds the corresponding JSON file in the `.cody/nodes` directory and deletes it. If the file is not found, an error message is displayed.
 *
 * @param nodeTitle - The title of the custom node to be deleted.
 * @returns A Promise that resolves when the node has been deleted successfully.
 */
export async function deleteCustomNode(nodeTitle: string): Promise<void> {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace found.')
            return
        }
        const confirmed = await vscode.window.showWarningMessage(
            `Delete custom node "${nodeTitle}"?`,
            { modal: true },
            'Delete'
        )
        if (confirmed !== 'Delete') {
            return
        }

        const nodesDirUri = vscode.Uri.joinPath(workspaceRoot, CODY_NODES_DIR)
        const files = await vscode.workspace.fs.readDirectory(nodesDirUri)
        const nodeFile = files.find(([filename]) => filename.startsWith(sanitizeFilename(nodeTitle)))
        if (!nodeFile) {
            vscode.window.showErrorMessage(`Custom node with title "${nodeTitle}" not found.`)
            return
        }
        const fileUri = vscode.Uri.joinPath(nodesDirUri, nodeFile[0])
        await vscode.workspace.fs.delete(fileUri)
        vscode.window.showInformationMessage(
            `Custom node with title "${nodeTitle}" deleted successfully.`
        )
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to delete custom node: ${error.message}`)
    }
}

export async function renameCustomNode(oldNodeTitle: string, newNodeTitle: string): Promise<void> {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('No workspace found.')
            return
        }

        const nodesDirUri = vscode.Uri.joinPath(workspaceRoot, CODY_NODES_DIR)
        const files = await vscode.workspace.fs.readDirectory(nodesDirUri)
        const oldNodeFile = files.find(([filename]) =>
            filename.startsWith(sanitizeFilename(oldNodeTitle))
        )

        if (!oldNodeFile) {
            vscode.window.showErrorMessage(`Custom node with title "${oldNodeTitle}" not found.`)
            return
        }

        const oldFileUri = vscode.Uri.joinPath(nodesDirUri, oldNodeFile[0])
        const fileData = await vscode.workspace.fs.readFile(oldFileUri)
        const node = JSON.parse(fileData.toString()) as WorkflowNodes

        // Update the node's title
        node.data.title = newNodeTitle

        // Construct the new file URI
        const newFilename = `${sanitizeFilename(newNodeTitle)}.json`
        const newFileUri = vscode.Uri.joinPath(nodesDirUri, newFilename)

        // Write the updated node to the new file
        const { id, ...nodeToSave } = node
        await writeToCodyJSON(newFileUri, nodeToSave)

        // Delete the old file
        await vscode.workspace.fs.delete(oldFileUri)

        vscode.window.showInformationMessage(
            `Custom node "${oldNodeTitle}" renamed to "${newNodeTitle}" successfully.`
        )
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to rename custom node: ${error.message}`)
    }
}

/**
 * Sanitizes a filename by replacing any non-alphanumeric, non-underscore, and non-hyphen characters with an underscore.
 *
 * @param name - The filename to be sanitized.
 * @returns The sanitized filename.
 */
function sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}
