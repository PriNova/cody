import { Globe, Plus, SaveIcon, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '../../shadcn/ui/button'
import { Label } from '../../shadcn/ui/label'
import type { ServerType } from '../types'

const DEFAULT_CONFIG = {
    id: crypto.randomUUID(), // Add a unique id
    name: '',
    type: 'MCP', // Keep type as MCP for new servers by default
    status: 'online' as const,
    icon: Globe,
    url: '',
    command: '',
    args: [''],
    env: [{ name: '', value: '' }],
} satisfies ServerType

interface AddServerFormProps {
    onAddServer?: (server: ServerType) => void // Optional for adding new servers
    onSave?: (server: ServerType) => void // Optional for saving existing servers
    _server?: ServerType // Server data to pre-populate the form (for editing)
    className?: string
}
// Use _server to initialize state, fallback to DEFAULT_CONFIG for new forms
export function AddServerForm({ onAddServer, onSave, _server, className }: AddServerFormProps) {
    // Initialize state with _server data if editing, otherwise use default config
    const [formData, setFormData] = React.useState<ServerType>(
        _server ? { ..._server } : { ...DEFAULT_CONFIG }
    )

    React.useEffect(() => {
        // Reset form data when _server prop changes (e.g., selecting a different server)
        setFormData(_server ? { ..._server } : { ...DEFAULT_CONFIG })
    }, [_server])

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        // Determine which save handler to call based on props
        if (_server && onSave) {
            onSave(formData) // Call onSave prop for existing servers
            // Do NOT reset form here, parent (ServerDetailView) handles state
        } else if (onAddServer) {
            onAddServer(formData) // Call onAddServer prop for new servers
            setFormData({ ...DEFAULT_CONFIG }) // Reset form for new server addition
        }
        // If neither prop is provided, the button does nothing on submit (shouldn't happen with proper usage)
    }

    // Helper function to update nested properties
    const updateFormData = (field: keyof ServerType, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }))
    }

    const updateArg = (index: number, arg: string) => {
        const args = formData.args ? [...formData.args] : []
        args[index] = arg
        updateFormData('args', args)
    }

    const addArg = () => {
        const args = formData.args ? [...formData.args] : []
        updateFormData('args', [...args, ''])
    }

    const removeArg = (index: number) => {
        const args = formData.args ? [...formData.args] : []
        const newArgs = args.filter((_, i) => i !== index)
        updateFormData('args', newArgs)
    }

    const updateEnvVar = (index: number, field: 'name' | 'value', value: string) => {
        const env = formData.env ? [...formData.env] : []
        if (env[index]) {
            env[index][field] = value
            updateFormData('env', env)
        }
    }

    const addEnvVar = () => {
        const env = formData.env ? [...formData.env] : []
        updateFormData('env', [...env, { name: '', value: '' }])
    }

    const removeEnvVar = (index: number) => {
        const env = formData.env ? [...formData.env] : []
        const newEnv = env.filter((_, i) => i !== index)
        updateFormData('env', newEnv)
    }

    return (
        <form onSubmit={handleSubmit} className={className}>
            {' '}
            {/* Added className prop */}
            <div className="tw-grid tw-gap-4 tw-py-4 tw-text-sm">
                <div className="tw-grid tw-grid-cols-2 tw-gap-4">
                    <div className="tw-space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <input
                            type="text"
                            id="name"
                            value={formData.name}
                            name="name"
                            onChange={e => updateFormData('name', e.target.value)}
                            className="tw-block tw-py-2.5 tw-px-0 tw-w-full tw-text-sm tw-text-gray-900 tw-bg-transparent tw-border-0 tw-border-b-2 tw-border-gray-300 tw-appearance-none dark:tw-text-white dark:tw-border-gray-600 dark:focus:tw-border-blue-500 focus:tw-outline-none focus:tw-ring-0 focus:tw-border-blue-600 peer"
                            placeholder=" "
                            required
                        />
                    </div>
                    {/* Adding Type field as it exists in ServerType */}
                    <div className="tw-space-y-2">
                        <Label htmlFor="type">Type</Label>
                        <input
                            type="text"
                            id="type"
                            value={formData.type}
                            onChange={e => updateFormData('type', e.target.value)}
                            className="tw-block tw-py-2.5 tw-px-0 tw-w-full tw-text-sm tw-text-gray-900 tw-bg-transparent tw-border-0 tw-border-b-2 tw-border-gray-300 tw-appearance-none dark:tw-text-white dark:tw-border-gray-600 dark:focus:tw-border-blue-500 focus:tw-outline-none focus:tw-ring-0 focus:tw-border-blue-600 peer"
                            placeholder="e.g., MCP, LSP, etc."
                            required
                        />
                    </div>
                </div>

                <div className="tw-space-y-2">
                    <Label htmlFor="command">Command</Label>
                    <input
                        id="command"
                        value={formData.command}
                        onChange={e => updateFormData('command', e.target.value)} // FIX: Correctly update 'command'
                        className="tw-block tw-py-2.5 tw-px-0 tw-w-full tw-text-sm tw-text-gray-900 tw-bg-transparent tw-border-0 tw-border-b-2 tw-border-gray-300 tw-appearance-none dark:tw-text-white dark:tw-border-gray-600 dark:focus:tw-border-blue-500 focus:tw-outline-none focus:tw-ring-0 focus:tw-border-blue-600 peer"
                        placeholder="npx"
                        required
                    />
                </div>

                <div className="tw-space-y-2">
                    <Label htmlFor="url">URL</Label>
                    <input
                        id="url"
                        size={12}
                        value={formData.url}
                        onChange={e => updateFormData('url', e.target.value)} // Correctly update 'url'
                        className="tw-block tw-py-2.5 tw-px-0 tw-w-full tw-text-sm tw-text-gray-900 tw-bg-transparent tw-border-0 tw-border-b-2 tw-border-gray-300 tw-appearance-none dark:tw-text-white dark:tw-border-gray-600 dark:focus:tw-border-blue-500 focus:tw-outline-none focus:tw-ring-0 focus:tw-border-blue-600 peer"
                        placeholder="Make sure you pass in the absolute path to your server."
                        required
                    />
                </div>

                <div className="tw-space-y-3">
                    <div className="tw-flex tw-items-center tw-justify-between">
                        <Label>Arguments</Label>
                        <Button type="button" variant="ghost" size="sm" onClick={addArg}>
                            {' '}
                            {/* Use addArg function */}
                            <Plus size={14} />
                        </Button>
                    </div>

                    {formData?.args?.map((arg, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: Using index for now, consider stable IDs if args could be reordered
                        <div key={index} className="tw-flex tw-gap-2 tw-items-center">
                            <input
                                value={arg}
                                placeholder=""
                                onChange={e => updateArg(index, e.target.value)} //{/* Use updateArg */}
                                className="tw-block tw-py-2.5 tw-px-0 tw-w-full tw-text-sm tw-text-gray-900 tw-bg-transparent tw-border-0 tw-border-b-2 tw-border-gray-300 tw-appearance-none dark:tw-text-white dark:tw-border-gray-600 dark:focus:tw-border-blue-500 focus:tw-outline-none focus:tw-ring-0 focus:tw-border-blue-600 peer"
                            />
                            {/* Render remove button only if there's more than one arg */}
                            {formData.args && formData.args.length > 1 && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="tw-shrink-0"
                                    onClick={() => removeArg(index)} // {/* Use removeArg */}
                                >
                                    <X size={14} className="tw-ml-1" />
                                </Button>
                            )}
                        </div>
                    ))}
                    {/* Add a button to add the first argument if args is empty */}
                    {(!formData.args || formData.args.length === 0) && (
                        <Button type="button" variant="ghost" size="sm" onClick={addArg}>
                            <Plus size={14} /> Add Argument
                        </Button>
                    )}
                </div>

                <div className="tw-space-y-2">
                    <div className="tw-flex tw-items-center tw-justify-between">
                        <Label>Environment Variables</Label>
                        <Button type="button" variant="ghost" size="sm" onClick={addEnvVar}>
                            {' '}
                            {/* Use addEnvVar */}
                            <Plus size={14} />
                        </Button>
                    </div>
                </div>
                <div className="tw-space-y-3 tw-w-full">
                    {formData?.env?.map((env, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: Using index for now, consider stable IDs if env vars could be reordered
                        <div key={index} className="tw-flex tw-gap-2 tw-items-center">
                            <input
                                value={env.name}
                                placeholder="Name"
                                onChange={e => updateEnvVar(index, 'name', e.target.value)} //{/* Use updateEnvVar */}
                                className="tw-block tw-py-2.5 tw-px-0 tw-w-full tw-text-sm tw-text-gray-900 tw-bg-transparent tw-border-0 tw-border-b-2 tw-border-gray-300 tw-appearance-none dark:tw-text-white dark:tw-border-gray-600 dark:focus:tw-border-blue-500 focus:tw-outline-none focus:tw-ring-0 focus:tw-border-blue-600 peer"
                            />
                            <span className="tw-mx-1">=</span>
                            <input
                                value={env.value}
                                placeholder="Value"
                                onChange={e => updateEnvVar(index, 'value', e.target.value)} //{/* Use updateEnvVar */}
                                className="tw-block tw-py-2.5 tw-px-0 tw-w-full tw-text-sm tw-text-gray-900 tw-bg-transparent tw-border-0 tw-border-b-2 tw-border-gray-300 tw-appearance-none dark:tw-text-white dark:tw-border-gray-600 dark:focus:tw-border-blue-500 focus:tw-outline-none focus:tw-ring-0 focus:tw-border-blue-600 peer"
                            />
                            {/* Render remove button only if there's more than one env var */}
                            {formData.env && formData.env.length > 1 && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="tw-shrink-0"
                                    onClick={() => removeEnvVar(index)} //{/* Use removeEnvVar */}
                                >
                                    <X size={14} className="tw-ml-1" />
                                </Button>
                            )}
                        </div>
                    ))}
                    {/* Add a button to add the first env var if env is empty */}
                    {(!formData.env || formData.env.length === 0) && (
                        <Button type="button" variant="ghost" size="sm" onClick={addEnvVar}>
                            <Plus size={14} /> Add Environment Variable
                        </Button>
                    )}
                </div>
            </div>
            {/* This Save button is for the form itself, can be removed if only using parent Save Changes */}
            {/* Keeping it here for now, but its role changes slightly - it reports state up */}
            <div>
                {/* Make the button type="submit" so it triggers handleSubmit */}
                <Button variant="default" size="sm" className="tw-inline-flex tw-w-full" type="submit">
                    <SaveIcon size={12} className="tw-mr-1" /> Save Form
                </Button>
            </div>
        </form>
    )
}
