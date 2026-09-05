import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './IconButton.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'ghost' | 'primary' | 'danger' | 'subtle';
  size?: 'sm' | 'md';
  title?: string;
}

export function IconButton({
  children,
  variant = 'ghost',
  size = 'md',
  className,
  ...rest
}: Props) {
  const cls = [styles.btn, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
