import * as fs from 'node:fs'
import * as path from 'node:path'
import { type ContextItem, ContextItemSource } from '@sourcegraph/cody-shared'
import type { ContextItemWorkflows } from '@sourcegraph/cody-shared/src/codebase-context/messages'
import { WORKFLOW_PROVIDER } from '@sourcegraph/cody-shared/src/mentions/api'
import * as vscode from 'vscode'
import { URI } from 'vscode-uri'
import { CODY_WORKFLOWS_DIR } from '../../workflow/workflow-io'

export function getWorkflowForMention(query: string): ContextItem[] {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return []
    }

    const customLinks: Array<{ name: string; url: string; description: string }> = []

    // Scan all workspace folders for workflows
    for (const folder of workspaceFolders) {
        const workflowsDir = path.join(folder.uri.path, CODY_WORKFLOWS_DIR)

        // Check if the workflows directory exists
        if (fs.existsSync(workflowsDir)) {
            try {
                const files = fs.readdirSync(workflowsDir)

                // Filter for JSON files
                const jsonFiles = files.filter(file => file.endsWith('.json'))

                // Create a link for each JSON file
                for (const file of jsonFiles) {
                    const filePath = path.join(workflowsDir, file)
                    const fileUri = vscode.Uri.file(filePath)
                    const fileName = path.basename(file, '.json')

                    customLinks.push({
                        name: fileName,
                        url: fileUri.toString(),
                        description: 'Workflow',
                    })
                }
            } catch (error) {
                console.error('Error reading workflows directory:', error)
            }
        }
    }

    // Only filter links if a non-empty query is provided
    let linksToReturn = customLinks
    if (query && query.trim().length > 0) {
        linksToReturn = customLinks.filter(
            link =>
                link.name.toLowerCase().includes(query.toLowerCase()) ||
                link.description.toLowerCase().includes(query.toLowerCase())
        )
    }

    // Sort the links alphabetically by name
    linksToReturn.sort((a, b) => a.name.localeCompare(b.name))

    // Convert to ContextItems
    return linksToReturn.map(
        link =>
            ({
                type: 'workflows',
                uri: URI.parse(link.url),
                name: link.name, // Required property based on similar interfaces
                title: link.name,
                description: link.description,
                content: 'Workflow',
                source: ContextItemSource.User,
                provider: WORKFLOW_PROVIDER.id,
            }) as ContextItemWorkflows
    )
}
