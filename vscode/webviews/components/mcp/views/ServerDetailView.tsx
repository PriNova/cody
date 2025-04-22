import { Power } from 'lucide-react'
import * as React from 'react'
import { Button } from '../../shadcn/ui/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '../../shadcn/ui/card'
import type { ServerType } from '../types' // Assuming this type includes command, args, env, url
import { AddServerForm } from './AddServerForm'

interface ServerDetailViewProps {
    server: ServerType // This will now have command, args, env, url directly
    onUpdateServer: (server: ServerType) => void
    onCancel: () => void
}

export function ServerDetailView({ server, onUpdateServer, onCancel }: ServerDetailViewProps) {
    // Initialize state by simply copying the received server object
    // The parsing and mapping happened upstream in CodyPanel.tsx
    const [editingServerData, setEditingServerData] = React.useState<ServerType>(server)

    React.useEffect(() => {
        // Update state when the parent server prop changes (e.g., selecting a different server)
        setEditingServerData(server)
    }, [server]) // Depend on the server prop

    const handleFormSave = (data: ServerType) => {
        // This is called by AddServerForm's internal save button (which is hidden).
        // It updates ServerDetailView's state, but doesn't save globally yet.
        setEditingServerData(data)
    }

    const handleSaveChanges = () => {
        // This button in ServerDetailView triggers the global save
        // Pass the current editingServerData state directly.
        // The parent component (ServerHome/ServerDashboard) will need to
        // reconstruct the backend config string from this ServerType object.
        onUpdateServer(editingServerData)
    }

    const handleReset = () => {
        // Reset to the initial server data received
        setEditingServerData(server)
    }

    const isDataChanged = React.useMemo(() => {
        // Compare the current state with the initial server prop
        // Using JSON.stringify for a simple comparison, but be aware of potential
        // issues with key order or differences in default values.
        return JSON.stringify(editingServerData) !== JSON.stringify(server)
    }, [editingServerData, server])

    return (
        <div className="tw-container tw-p-6 tw-w-full">
            <Card className="tw-m-6 tw-w-full">
                <CardHeader>
                    <CardTitle>{server.name}</CardTitle>
                    <CardDescription>
                        {/* Assuming Connect/Disconnect logic needs server status */}
                        {/* You might need to handle the connection status via extension API calls */}
                        <Button variant="default" size="sm">
                            <Power size={12} />
                            {server.status === 'online' ? 'Disconnect' : 'Connect'}
                        </Button>
                        {onCancel && (
                            <Button variant="ghost" size="sm" className="tw-ml-2" onClick={onCancel}>
                                Cancel
                            </Button>
                        )}
                    </CardDescription>
                </CardHeader>
                <CardContent className="tw-space-y-6">
                    {/* Pass the state down to the form */}
                    <AddServerForm _server={editingServerData} onSave={handleFormSave} />
                </CardContent>
                <CardFooter className="tw-flex tw-justify-between">
                    <Button variant="outline" onClick={handleReset} disabled={!isDataChanged}>
                        Reset
                    </Button>
                    {/* Use the handleSaveChanges function */}
                    <Button onClick={handleSaveChanges} disabled={!isDataChanged}>
                        Save Changes
                    </Button>
                </CardFooter>
            </Card>
        </div>
    )
}
