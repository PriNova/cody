import type React from 'react'

export const CodyAILogo: React.FunctionComponent<
    React.PropsWithChildren<React.SVGAttributes<SVGSVGElement>> & { size: number }
> = ({ size, ...props }) => (
    <svg
        width="1.2em"
        height="1.2em"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 38 38"
        data-icon="true"
        aria-label="Sourcegraph"
        aria-hidden="true"
    >
        <g clip-path="url(#a)">
            <g fill="#F34E3F" clip-path="url(#b)">
                <path d="m15.308 10.493 4.604 1.228L16.776 0l-5.31 1.43 1.89 7.107c.253.953 1 1.703 1.952 1.956M7.524 34.367l10.044-10.025L21.224 38l5.31-1.43-5.29-19.83-19.832-5.286L0 16.794l13.646 3.648-10.003 10.01zM26.252 18.066l1.233 4.624a2.76 2.76 0 0 0 1.951 1.954l7.15 1.9 1.412-5.34zM30.474 3.63l-4.57 4.566a2.76 2.76 0 0 0-.812 1.89l-.073 2.895 2.677.094c-.035 0 .034 0 0 0 .733 0 1.422-.287 1.94-.805l4.718-4.724z" />
            </g>
        </g>
        <defs>
            <clipPath id="a">
                <path fill="#fff" d="M0 0h38v38H0z" />
            </clipPath>
            <clipPath id="b">
                <path fill="#fff" d="M0 0h38v38H0z" />
            </clipPath>
        </defs>
    </svg>
)
