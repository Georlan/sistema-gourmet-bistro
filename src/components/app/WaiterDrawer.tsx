import type { KeyboardEvent } from 'react';
import { ChevronRight, CircleHelp, History, LogOut, Moon, SlidersHorizontal, Sun, X } from 'lucide-react';
import { KomaLogo } from '../KomaLogo';
import { KomaWaiterGlyph } from '../shared/KomaWaiterGlyphs';
import { persistKomaTextSize, readKomaTextSize } from '../../config/textSize';
import { readOperationalDrafts } from './drafts/operationalDraftStorage';
import { openCustomerSupport } from './customerSupportEvents';
import type { OperationalDrawerProps } from './OperationalDrawerLegacy';

function containFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, summary, [tabindex="0"]')]
    .filter(node => node.getClientRects().length > 0 && !node.hasAttribute('disabled'));
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}

/** Hook-free to preserve the existing drawer boundary and lightweight static rendering contract. */
export function WaiterDrawer(props: OperationalDrawerProps) {
  const { onClose, activeWaiterName, waiterAvailable, theme, settings } = props;
  const fontSize = readKomaTextSize();
  const drafts = Object.entries(readOperationalDrafts('garcom')).filter(([, items]) => items.length > 0);
  const navigate = (action: () => void) => {
    onClose();
    if (typeof window !== 'undefined') window.requestAnimationFrame(action);
  };
  return <div className="kw-drawer-overlay">
    <button id="sidebar-backdrop" className="kw-drawer-backdrop" aria-label="Fechar central" onClick={onClose} tabIndex={-1} />
    <aside className="kw-drawer" role="dialog" aria-modal="true" aria-label="Central do Garçom"
      onKeyDown={event => { if (event.key === 'Escape') onClose(); containFocus(event); }}>
      <header className="kw-drawer__header"><KomaLogo withText variant="dark" size="md" />
        <button id="close-sidebar-btn" aria-label="Fechar menu lateral" className="kw-icon-button" onClick={onClose}
          ref={node => { if (node && !node.closest('aside')?.contains(document.activeElement)) node.focus(); }}><X size={20} /></button>
      </header>
      <div className="kw-drawer__body">
        <section className="kw-operator">
          <span className="kw-avatar">{(activeWaiterName || 'G').trim().charAt(0)}</span>
          <div><strong>{activeWaiterName || 'Garçom'}</strong><span>{props.restaurantName}</span></div>
        </section>
        <button id="waiter-availability-toggle" className="kw-availability" aria-pressed={waiterAvailable}
          onClick={() => props.onWaiterAvailabilityChange(!waiterAvailable)}>
          <span className="kw-availability-dot" />{waiterAvailable ? 'Disponível' : 'Em atendimento'}<span>Alterar</span>
        </button>
        <nav aria-label="Atendimento" className="kw-menu">
          <button id="drawer-open-history" onClick={() => navigate(() => props.onOpenHistory?.())}><History size={20} /><span>Meu histórico</span><ChevronRight size={17} /></button>
          {drafts.length > 0 && <details className="kw-draft-list"><summary><KomaWaiterGlyph name="draft-saved" /><span>Rascunhos</span><b>{drafts.length}</b></summary>
            {drafts.map(([tableId, items]) => <button id={`drawer-resume-draft-${tableId}`} key={tableId} onClick={() => navigate(() => props.onOpenTable ? props.onOpenTable(Number(tableId), 'lancamento') : document.getElementById(`mesa-card-${tableId}`)?.click())}>
              <span>Mesa {tableId}</span><b>{items.reduce((sum, item) => sum + (item.quantidade || 1), 0)} itens</b><ChevronRight size={16} />
            </button>)}
          </details>}
        </nav>
        <nav aria-label="Ferramentas" className="kw-menu kw-menu--secondary">
          <button id="drawer-open-customer-support" onClick={() => navigate(openCustomerSupport)}><CircleHelp size={20} /><span>Ajuda e feedback</span><ChevronRight size={17} /></button>
        </nav>
        <details className="kw-preferences"><summary><SlidersHorizontal size={20} /><span>Preferências</span></summary>
          <div className="kw-preferences__content">
            <button className="kw-theme-toggle" onClick={props.onToggleTheme} title={theme === 'dark' ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}<span>{theme === 'dark' ? 'Tema escuro' : 'Tema claro'}</span><span>Alterar</span>
            </button>
            <fieldset className="kw-text-size"><legend>Tamanho do texto</legend><div>
              {([['padrao', 'Padrão'], ['grande', 'Grande'], ['gigante', 'Gigante']] as const).map(([value, label]) => <button
                key={value} id={`drawer-font-${value}`} aria-pressed={fontSize === value} onClick={() => persistKomaTextSize(value)}>{label}</button>)}
            </div></fieldset>
            <label className="kw-setting"><span>Fotos dos produtos</span><input id="sidebar-toggle-images" type="checkbox" checked={settings.exibirImagens} onChange={event => props.onSettingsChange({ ...settings, exibirImagens: event.target.checked })} /></label>
            <label className="kw-setting"><span>Descrição dos produtos</span><input id="sidebar-toggle-descriptions" type="checkbox" checked={settings.exibirDescricoes} onChange={event => props.onSettingsChange({ ...settings, exibirDescricoes: event.target.checked })} /></label>
          </div>
        </details>
      </div>
      <footer className="kw-drawer__footer"><button onClick={props.onLogout}><LogOut size={18} />Sair</button></footer>
    </aside>
  </div>;
}
