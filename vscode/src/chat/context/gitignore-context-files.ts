import { exec } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/**
 * Recursively traverses a folder and its subfolders, collecting a list of file paths that are not ignored by the Git repository.
 *
 * @param folderPath - The path of the folder to traverse.
 * @param rootFolderPath - The root folder path of the Git repository.
 * @param fileList - An optional array to collect the file paths. If not provided, a new array will be created.
 * @returns A Promise that resolves to an array of file paths that are not ignored by the Git repository.
 */
export async function traverse(
    folderPath: string,
    rootFolderPath: string,
    fileList: string[] = []
): Promise<string[]> {
    try {
        const entries = await fs.readdir(folderPath, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = path.join(folderPath, entry.name)

            if (entry.name === '.git') {
                continue
            }

            const isPathIgnored = await isIgnored(fullPath, rootFolderPath)

            if (isPathIgnored) {
                continue
            }

            console.log(`Processing: ${fullPath}`)

            if (entry.isDirectory()) {
                await traverse(fullPath, rootFolderPath, fileList)
            } else if (entry.isFile()) {
                fileList.push(fullPath)
            }
        }
        return fileList
    } catch (error) {
        if (error instanceof Error) {
            console.error(`Error reading directory ${folderPath}:`, error.message)
        } else {
            console.error(`Unknown error reading directory ${folderPath}`)
        }
        return fileList
    }
}

/**
 * Checks if the given file path is ignored by the Git repository.
 *
 * @param filePath - The file path to check for Git ignore.
 * @param rootFolderPath - The root folder path of the Git repository.
 * @returns A Promise that resolves to `true` if the file is ignored, `false` otherwise.
 */
export async function isIgnored(filePath: string, rootFolderPath: string): Promise<boolean> {
    return new Promise(resolve => {
        exec(`git check-ignore ${filePath}`, { cwd: rootFolderPath }, (error, stdout, _stderr) => {
            if (error) {
                // if git check-ignore returns an error, it means the file is not ignored
                resolve(false)
            } else {
                // If git check-ignore outputs something, it means the file is ignored
                resolve(stdout.trim() !== '')
            }
        })
    })
}
