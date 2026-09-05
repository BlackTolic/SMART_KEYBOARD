import styles from './Sidebar.module.css';

export type PageId = 'editor' | 'about';

interface Props {
  current: PageId;
  onChange: (id: PageId) => void;
}

const ITEMS: { id: PageId; label: string; hint: string }[] = [
  { id: 'editor', label: 'Editor', hint: 'Build your steps' },
  { id: 'about', label: 'About', hint: 'Version & credits' }
];

export function Sidebar({ current, onChange }: Props) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.logo}>SK</div>
        <div className={styles.brandText}>
          <div className={styles.brandTitle}>SmartKeyboard</div>
          <div className={styles.brandSub}>Automation</div>
        </div>
      </div>

      <nav className={styles.nav}>
        {ITEMS.map((item) => {
          const active = item.id === current;
          return (
            <button
              key={item.id}
              className={[styles.navItem, active ? styles.active : ''].join(' ')}
              onClick={() => onChange(item.id)}
            >
              <span className={styles.navLabel}>{item.label}</span>
              <span className={styles.navHint}>{item.hint}</span>
            </button>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <span className={styles.footerLabel}>v0.1.0</span>
        <span className={styles.footerHint}>minimal build</span>
      </div>
    </aside>
  );
}
