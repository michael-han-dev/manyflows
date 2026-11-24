import type { ReactNode } from 'react';

type PageHeadingProps = {
  title: string;
  text?: string;
  action?: ReactNode;
};

export function PageHeading({ title, text, action }: PageHeadingProps) {
  return <header className="page-heading">
    <div><h1>{title}</h1>{text && <p>{text}</p>}</div>
    {action}
  </header>;
}
