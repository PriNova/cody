import type { Item } from '@openctx/client'
import {
    RULES_PROVIDER_URI,
    type Rule,
    firstValueFrom,
    pluralize,
    ruleTitle,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import { URI } from 'vscode-uri'
import { ruleService } from '../../rules/service'
import type { OpenCtxProvider } from './types'

/**
 * An OpenCtx provider that attaches rules for the current file.
 *
 * TODO(sqs): Should include rules that apply to @-mentioned files, but there is no current way to
 * read the list of @-mentions in the `mentions` or `items` methods.
 */
export function createRulesProvider(): OpenCtxProvider {
    return {
        providerUri: RULES_PROVIDER_URI,

        meta() {
            return {
                name: 'Rules',
                mentions: {
                    autoInclude: true,
                    parameters: ['query'],
                },
            }
        },

        async mentions({ autoInclude, uri, query }) {
            // Collect all paths to check for rules
            const pathsToCheck: URI[] = []

            // Add active file URI if available
            if (uri) {
                pathsToCheck.push(URI.parse(uri))
            }

            // Always add all workspace folders to ensure rules are shown regardless of active editor
            if (vscode.workspace.workspaceFolders?.length) {
                for (const folder of vscode.workspace.workspaceFolders) {
                    pathsToCheck.push(folder.uri)
                }
            }

            // Get rules for all collected paths
            // If no paths were provided, we'll still get rules for all workspace folders
            // because we've updated the fs-rule-provider to handle this case
            const rules = await firstValueFrom(ruleService.rulesForPaths(pathsToCheck))

            // If no rules found or error occurred
            if (!rules || rules.length === 0) {
                // Try one more time with the workspace root if we haven't already
                if (pathsToCheck.length === 0 && vscode.workspace.workspaceFolders?.length) {
                    const workspaceRoots = vscode.workspace.workspaceFolders.map(folder => folder.uri)
                    const rootRules = await firstValueFrom(ruleService.rulesForPaths(workspaceRoots))

                    if (rootRules && rootRules.length > 0) {
                        return autoInclude
                            ? [
                                  {
                                      title: `${rootRules.length} ${pluralize(
                                          'rule',
                                          rootRules.length
                                      )}`,
                                      description: rootRules.map(r => ruleTitle(r)).join('\n'),
                                      uri: 'rules+openctx://rules',
                                      data: { rules: rootRules },
                                  },
                              ]
                            : rootRules.map(rule => ({
                                  title: ruleTitle(rule),
                                  description:
                                      rule.description ||
                                      rule.instruction?.substring(0, 50) + '...' ||
                                      '',
                                  uri: `rules+openctx://rule/${encodeURIComponent(rule.uri)}`,
                                  data: { rule },
                              }))
                    }
                }
                return autoInclude
                    ? []
                    : [
                          {
                              title: 'No rules found',
                              description:
                                  'No rules match your search criteria or no rules exist in this workspace',
                              uri: 'rules+openctx://no-rules',
                              data: { noRules: true },
                          },
                      ]
            }

            // For the initial context auto-include, return a single combined item
            if (autoInclude) {
                return [
                    {
                        title: `${rules.length} ${pluralize('rule', rules.length)}`,
                        description: rules.map(r => ruleTitle(r)).join('\n'),
                        uri: 'rules+openctx://rules', // dummy URI
                        data: { rules },
                    },
                ]
            }

            // For the mention menu (when autoInclude is false), filter and return individual rules
            let filteredRules = rules

            // If there's a search query, filter rules by title and description
            if (query) {
                const lowerQuery = query.toLowerCase()
                filteredRules = rules.filter(rule => {
                    const title = ruleTitle(rule).toLowerCase()
                    const description = (rule.description || '').toLowerCase()
                    const instruction = (rule.instruction || '').toLowerCase()

                    return (
                        title.includes(lowerQuery) ||
                        description.includes(lowerQuery) ||
                        instruction.includes(lowerQuery)
                    )
                })
            }

            // Return individual rules as separate mentions
            return filteredRules.map(rule => ({
                title: ruleTitle(rule),
                description: rule.description || rule.instruction?.substring(0, 50) + '...' || '',
                uri: `rules+openctx://rule/${encodeURIComponent(rule.uri)}`,
                data: { rule },
            }))
        },

        async items(params) {
            // Handle "no rules found" case
            if (params.mention?.data?.noRules) {
                return []
            }

            // Handle the case where all rules are selected together
            if (params.mention?.data?.rules) {
                const rules = params.mention.data.rules as Rule[]
                return rules.map(
                    rule =>
                        ({
                            url: rule.uri,
                            title: rule.title ?? rule.display_name,
                            ai: { content: rule.instruction ?? undefined },
                        }) satisfies Item
                )
            }
            // Handle the case where a single rule is selected
            if (params.mention?.data?.rule) {
                const rule = params.mention.data.rule as Rule
                return [
                    {
                        url: rule.uri,
                        title: rule.title ?? rule.display_name,
                        ai: { content: rule.instruction ?? undefined },
                    } satisfies Item,
                ]
            }

            return []
        },
    }
}
