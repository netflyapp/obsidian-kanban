import { moment } from 'obsidian';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/compat';
import { StateManager } from 'src/StateManager';
import { Path } from 'src/dnd/types';
import { buildLinkToDailyNote } from 'src/helpers';
import { t } from 'src/lang/helpers';

import { BoardModifiers } from '../../helpers/boardModifiers';
import { Icon } from '../Icon/Icon';
import { KanbanContext } from '../context';
import { c, escapeRegExpStr } from '../helpers';
import { Board, Item } from '../types';

type CalendarMode = 'month' | 'week';
const HOUR_HEIGHT = 40; // px per hour in week view
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;

interface CalendarViewProps {
  boardData: Board;
  stateManager: StateManager;
}

interface ItemEntry {
  item: Item;
  path: Path;
  laneTitle: string;
  laneIdx: number;
}

type ModalState =
  | { kind: 'closed' }
  | {
      kind: 'create';
      date: moment.Moment;
      laneIdx: number;
      text: string;
      time: string; // HH:mm or empty
    }
  | { kind: 'edit'; path: Path; text: string; time: string };

function getTriggers(stateManager: StateManager) {
  const dateTrigger = stateManager.getSetting('date-trigger') as string;
  const timeTrigger = stateManager.getSetting('time-trigger') as string;
  const shouldLinkDates = stateManager.getSetting('link-date-to-daily-note');
  const dateContent = shouldLinkDates
    ? '(?:\\[[^\\]]+\\]\\([^)]+\\)|\\[\\[[^\\]]+\\]\\])'
    : '{[^}]+}';
  return {
    dateTrigger,
    timeTrigger,
    shouldLinkDates,
    dateRegex: new RegExp(`(^|\\s)${escapeRegExpStr(dateTrigger)}${dateContent}`, 'g'),
    timeRegex: new RegExp(`(^|\\s)${escapeRegExpStr(timeTrigger)}{[^}]+}`, 'g'),
  };
}

function buildDateSuffix(stateManager: StateManager, date: moment.Moment): string {
  const dateTrigger = stateManager.getSetting('date-trigger') as string;
  const shouldLinkDates = stateManager.getSetting('link-date-to-daily-note');
  const dateFormat = stateManager.getSetting('date-format') as string;
  const formatted = date.format(dateFormat);
  const wrapped = shouldLinkDates
    ? buildLinkToDailyNote(stateManager.app, formatted)
    : `{${formatted}}`;
  return `${dateTrigger}${wrapped}`;
}

function buildTimeSuffix(stateManager: StateManager, timeStr: string): string {
  const timeTrigger = stateManager.getSetting('time-trigger') as string;
  return `${timeTrigger}{${timeStr}}`;
}

function stripTriggers(stateManager: StateManager, titleRaw: string): string {
  const { dateRegex, timeRegex } = getTriggers(stateManager);
  return titleRaw.replace(dateRegex, '').replace(timeRegex, '').replace(/\s+/g, ' ').trim();
}

function setItemDateTime(
  stateManager: StateManager,
  boardModifiers: BoardModifiers,
  item: Item,
  path: Path,
  newDate: moment.Moment | null,
  newTime: string | null // 'HH:mm' or null
) {
  const { dateRegex, timeRegex } = getTriggers(stateManager);
  let titleRaw = item.data.titleRaw;

  // Strip existing date and time triggers
  titleRaw = titleRaw.replace(dateRegex, '').replace(timeRegex, '').replace(/\s+/g, ' ').trim();

  if (newDate) {
    titleRaw = `${titleRaw} ${buildDateSuffix(stateManager, newDate)}`.trim();
  }
  if (newTime) {
    titleRaw = `${titleRaw} ${buildTimeSuffix(stateManager, newTime)}`.trim();
  }

  boardModifiers.updateItem(path, stateManager.updateItemContent(item, titleRaw));
}

function flattenItems(board: Board): ItemEntry[] {
  const out: ItemEntry[] = [];
  board.children.forEach((lane, laneIdx) => {
    lane.children.forEach((item, itemIdx) => {
      out.push({ item, path: [laneIdx, itemIdx], laneTitle: lane.data.title, laneIdx });
    });
  });
  return out;
}

function dayKey(d: moment.Moment): string {
  return d.format('YYYY-MM-DD');
}

function buildMonthGrid(anchor: moment.Moment): moment.Moment[] {
  const start = anchor.clone().startOf('month').startOf('week');
  const days: moment.Moment[] = [];
  for (let i = 0; i < 42; i++) days.push(start.clone().add(i, 'day'));
  return days;
}

function buildWeekGrid(anchor: moment.Moment): moment.Moment[] {
  const start = anchor.clone().startOf('week');
  const days: moment.Moment[] = [];
  for (let i = 0; i < 7; i++) days.push(start.clone().add(i, 'day'));
  return days;
}

function getItemTimeStr(item: Item): string {
  const t = item.data.metadata.time;
  if (t && t.isValid()) return t.format('HH:mm');
  // Fall back to raw timeStr
  if (item.data.metadata.timeStr) return item.data.metadata.timeStr;
  return '';
}

function getItemMinutes(item: Item): number | null {
  const timeStr = getItemTimeStr(item);
  if (!timeStr) return null;
  const m = timeStr.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(min)) return null;
  return h * 60 + min;
}

export function CalendarView({ boardData, stateManager }: CalendarViewProps) {
  const { boardModifiers } = useContext(KanbanContext);
  const [mode, setMode] = useState<CalendarMode>('month');
  const [anchor, setAnchor] = useState<moment.Moment>(moment());
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (modal.kind !== 'closed') {
      textareaRef.current?.focus();
    }
  }, [modal.kind]);

  const lanes = boardData.children;

  const entries = useMemo(() => flattenItems(boardData), [boardData]);

  const byDay = useMemo(() => {
    const map = new Map<string, ItemEntry[]>();
    const unscheduled: ItemEntry[] = [];
    for (const e of entries) {
      const d = e.item.data.metadata.date;
      if (d && d.isValid()) {
        const k = dayKey(d);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(e);
      } else {
        unscheduled.push(e);
      }
    }
    // Sort each day's items by time (timed first)
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ta = getItemMinutes(a.item);
        const tb = getItemMinutes(b.item);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta - tb;
      });
    }
    return { map, unscheduled };
  }, [entries]);

  const days = mode === 'month' ? buildMonthGrid(anchor) : buildWeekGrid(anchor);

  const goPrev = () =>
    setAnchor(anchor.clone().subtract(1, mode === 'month' ? 'month' : 'week'));
  const goNext = () => setAnchor(anchor.clone().add(1, mode === 'month' ? 'month' : 'week'));
  const goToday = () => setAnchor(moment());

  const headerLabel =
    mode === 'month'
      ? anchor.format('MMMM YYYY')
      : `${days[0].format('MMM D')} – ${days[6].format('MMM D, YYYY')}`;

  const today = moment();
  const weekdayLabels = useMemo(() => {
    const start = moment().startOf('week');
    return Array.from({ length: 7 }, (_, i) => start.clone().add(i, 'day').format('ddd'));
  }, []);

  // ---------- Drag & Drop ----------
  const dragRef = useRef<{ path: Path } | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const handleDragStart = (e: DragEvent, entry: ItemEntry) => {
    dragRef.current = { path: entry.path };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', entry.item.data.title || '');
      } catch {
        /* noop */
      }
    }
    e.stopPropagation();
  };

  const handleDragEnd = (e: DragEvent) => {
    dragRef.current = null;
    setDragOverKey(null);
    e.stopPropagation();
  };

  const handleDragOver = (e: DragEvent, key?: string) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (key !== undefined && dragOverKey !== key) setDragOverKey(key);
  };

  const moveToDayPreserveTime = (day: moment.Moment) => {
    if (!dragRef.current) return;
    const { path } = dragRef.current;
    const [laneIdx, itemIdx] = path;
    const item = boardData.children[laneIdx]?.children[itemIdx];
    if (!item) return;
    const existingTime = getItemTimeStr(item) || null;
    setItemDateTime(stateManager, boardModifiers, item, path, day.clone().startOf('day'), existingTime);
  };

  const moveToDayWithTime = (day: moment.Moment, timeStr: string) => {
    if (!dragRef.current) return;
    const { path } = dragRef.current;
    const [laneIdx, itemIdx] = path;
    const item = boardData.children[laneIdx]?.children[itemIdx];
    if (!item) return;
    setItemDateTime(stateManager, boardModifiers, item, path, day.clone().startOf('day'), timeStr);
  };

  const handleDropOnDay = (e: DragEvent, day: moment.Moment) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    moveToDayPreserveTime(day);
    dragRef.current = null;
    setDragOverKey(null);
  };

  const handleDropOnTimeSlot = (e: DragEvent, day: moment.Moment, columnEl: HTMLElement) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = columnEl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalMinutes = Math.max(0, Math.round((y / HOUR_HEIGHT) * 60));
    // Snap to 15 min
    const snapped = Math.min(24 * 60 - 15, Math.round(totalMinutes / 15) * 15);
    const h = Math.floor(snapped / 60);
    const min = snapped % 60;
    const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    moveToDayWithTime(day, timeStr);
    dragRef.current = null;
    setDragOverKey(null);
  };

  const handleDropOnAllDay = (e: DragEvent, day: moment.Moment) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    if (!dragRef.current) return;
    const { path } = dragRef.current;
    const [laneIdx, itemIdx] = path;
    const item = boardData.children[laneIdx]?.children[itemIdx];
    if (item) {
      // Drop on all-day strip → set date but clear time
      setItemDateTime(stateManager, boardModifiers, item, path, day.clone().startOf('day'), null);
    }
    dragRef.current = null;
    setDragOverKey(null);
  };

  const handleDropOnUnscheduled = (e: DragEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const { path } = dragRef.current;
    const [laneIdx, itemIdx] = path;
    const item = boardData.children[laneIdx]?.children[itemIdx];
    if (item) {
      setItemDateTime(stateManager, boardModifiers, item, path, null, null);
    }
    dragRef.current = null;
    setDragOverKey(null);
  };

  // ---------- Modal: create / edit ----------
  const openCreateForDay = (day: moment.Moment, time: string = '') => {
    if (!lanes.length) return;
    setModal({
      kind: 'create',
      date: day.clone().startOf('day'),
      laneIdx: 0,
      text: '',
      time,
    });
  };

  const openEdit = (entry: ItemEntry) => {
    setModal({
      kind: 'edit',
      path: entry.path,
      text: entry.item.data.titleRaw,
      time: getItemTimeStr(entry.item),
    });
  };

  const closeModal = () => setModal({ kind: 'closed' });

  const submitModal = () => {
    if (modal.kind === 'create') {
      const trimmed = modal.text.trim();
      if (!trimmed) return;
      let titleRaw = `${trimmed} ${buildDateSuffix(stateManager, modal.date)}`;
      if (modal.time) titleRaw = `${titleRaw} ${buildTimeSuffix(stateManager, modal.time)}`;
      const newItem = stateManager.getNewItem(titleRaw, ' ');
      boardModifiers.appendItems([modal.laneIdx, 0], [newItem]);
      closeModal();
    } else if (modal.kind === 'edit') {
      const [laneIdx, itemIdx] = modal.path;
      const item = boardData.children[laneIdx]?.children[itemIdx];
      if (!item) return closeModal();
      const trimmed = modal.text.trim();
      if (!trimmed) return closeModal();
      // Apply title edits first, then ensure time matches modal.time
      let titleRaw = trimmed;
      const { timeRegex } = getTriggers(stateManager);
      titleRaw = titleRaw.replace(timeRegex, '').replace(/\s+/g, ' ').trim();
      if (modal.time) titleRaw = `${titleRaw} ${buildTimeSuffix(stateManager, modal.time)}`;
      boardModifiers.updateItem(modal.path, stateManager.updateItemContent(item, titleRaw));
      closeModal();
    }
  };

  const deleteFromModal = () => {
    if (modal.kind !== 'edit') return;
    boardModifiers.deleteEntity(modal.path);
    closeModal();
  };

  // ---------- Render helpers ----------
  const renderCard = (entry: ItemEntry, opts?: { compact?: boolean }) => {
    const cleanTitle = stripTriggers(stateManager, entry.item.data.titleRaw) || '(empty)';
    const timeStr = getItemTimeStr(entry.item);
    return (
      <div
        key={entry.item.id}
        className={c('calendar-card') + (opts?.compact ? ' is-compact' : '')}
        title={`${entry.laneTitle}: ${cleanTitle}${timeStr ? ` (${timeStr})` : ''}`}
        draggable
        onDragStart={(e) => handleDragStart(e, entry)}
        onDragEnd={handleDragEnd}
        onClick={(e) => {
          e.stopPropagation();
          openEdit(entry);
        }}
      >
        <span className={c('calendar-card-lane')}>{entry.laneTitle}</span>
        <span className={c('calendar-card-title')}>
          {timeStr && <span className={c('calendar-card-time')}>{timeStr} </span>}
          {cleanTitle}
        </span>
      </div>
    );
  };

  return (
    <div className={c('calendar-wrapper')}>
      <div className={c('calendar-toolbar')}>
        <div className={c('calendar-nav')}>
          <button onClick={goPrev} aria-label={t('Previous')} className={c('calendar-btn')}>
            <Icon name="lucide-chevron-left" />
          </button>
          <button onClick={goToday} className={c('calendar-btn')}>
            {t('Today')}
          </button>
          <button onClick={goNext} aria-label={t('Next')} className={c('calendar-btn')}>
            <Icon name="lucide-chevron-right" />
          </button>
          <span className={c('calendar-label')}>{headerLabel}</span>
        </div>
        <div className={c('calendar-mode-switch')}>
          <button
            onClick={() => setMode('month')}
            className={c('calendar-btn') + (mode === 'month' ? ' is-active' : '')}
          >
            {t('Month')}
          </button>
          <button
            onClick={() => setMode('week')}
            className={c('calendar-btn') + (mode === 'week' ? ' is-active' : '')}
          >
            {t('Week')}
          </button>
        </div>
      </div>

      <div className={c('calendar-body')}>
        {mode === 'month' ? (
          <MonthGrid
            days={days}
            byDay={byDay.map}
            anchor={anchor}
            today={today}
            weekdayLabels={weekdayLabels}
            dragOverKey={dragOverKey}
            setDragOverKey={setDragOverKey}
            renderCard={renderCard}
            handleDragOver={handleDragOver}
            handleDropOnDay={handleDropOnDay}
            openCreateForDay={openCreateForDay}
          />
        ) : (
          <WeekGrid
            days={days}
            byDay={byDay.map}
            today={today}
            weekdayLabels={weekdayLabels}
            dragOverKey={dragOverKey}
            setDragOverKey={setDragOverKey}
            renderCard={renderCard}
            handleDragOver={handleDragOver}
            handleDropOnAllDay={handleDropOnAllDay}
            handleDropOnTimeSlot={handleDropOnTimeSlot}
            openCreateForDay={openCreateForDay}
          />
        )}

        <div
          className={
            c('calendar-unscheduled') + (dragOverKey === '__unscheduled' ? ' is-drag-over' : '')
          }
          onDragOver={(e) => handleDragOver(e, '__unscheduled')}
          onDragLeave={(e) => {
            const related = e.relatedTarget as Node | null;
            if (related && (e.currentTarget as Node).contains(related)) return;
            if (dragOverKey === '__unscheduled') setDragOverKey(null);
          }}
          onDrop={handleDropOnUnscheduled}
        >
          <div className={c('calendar-unscheduled-header')}>
            {t('Unscheduled')} ({byDay.unscheduled.length})
          </div>
          <div className={c('calendar-unscheduled-items')}>
            {byDay.unscheduled.map((entry) => renderCard(entry, { compact: true }))}
          </div>
        </div>
      </div>

      {modal.kind !== 'closed' && (
        <div
          className={c('calendar-modal-overlay')}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className={c('calendar-modal')}>
            <div className={c('calendar-modal-header')}>
              {modal.kind === 'create'
                ? `${t('Add a card')} — ${modal.date.format('YYYY-MM-DD')}`
                : t('Edit card')}
            </div>

            {modal.kind === 'create' && lanes.length > 1 && (
              <div className={c('calendar-modal-row')}>
                <label>{t('Lane')}: </label>
                <select
                  value={String(modal.laneIdx)}
                  onChange={(e) =>
                    setModal({
                      ...modal,
                      laneIdx: Number((e.target as HTMLSelectElement).value),
                    })
                  }
                >
                  {lanes.map((lane, i) => (
                    <option key={lane.id} value={String(i)}>
                      {lane.data.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className={c('calendar-modal-row')}>
              <label>{t('Time')}: </label>
              <input
                type="time"
                value={modal.time}
                onChange={(e) =>
                  setModal({
                    ...modal,
                    time: (e.target as HTMLInputElement).value,
                  } as ModalState)
                }
              />
              {modal.time && (
                <button
                  className={c('calendar-btn')}
                  onClick={() =>
                    setModal({ ...modal, time: '' } as ModalState)
                  }
                  title={t('Clear time')}
                >
                  ×
                </button>
              )}
            </div>

            <textarea
              ref={textareaRef}
              className={c('calendar-modal-textarea')}
              value={modal.text}
              onInput={(e) =>
                setModal({ ...modal, text: (e.target as HTMLTextAreaElement).value } as ModalState)
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitModal();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeModal();
                }
              }}
              placeholder={t('Card title...')}
              rows={5}
            />

            <div className={c('calendar-modal-actions')}>
              {modal.kind === 'edit' && (
                <button
                  className={c('calendar-btn') + ' mod-warning'}
                  onClick={deleteFromModal}
                >
                  {t('Delete')}
                </button>
              )}
              <div className={c('calendar-modal-spacer')} />
              <button className={c('calendar-btn')} onClick={closeModal}>
                {t('Cancel')}
              </button>
              <button
                className={c('calendar-btn') + ' is-active'}
                onClick={submitModal}
                disabled={!modal.text.trim()}
              >
                {t('Save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Month grid
// ============================================================
interface MonthGridProps {
  days: moment.Moment[];
  byDay: Map<string, ItemEntry[]>;
  anchor: moment.Moment;
  today: moment.Moment;
  weekdayLabels: string[];
  dragOverKey: string | null;
  setDragOverKey: (k: string | null) => void;
  renderCard: (entry: ItemEntry, opts?: { compact?: boolean }) => any;
  handleDragOver: (e: DragEvent, key?: string) => void;
  handleDropOnDay: (e: DragEvent, day: moment.Moment) => void;
  openCreateForDay: (day: moment.Moment, time?: string) => void;
}

function MonthGrid({
  days,
  byDay,
  anchor,
  today,
  weekdayLabels,
  dragOverKey,
  setDragOverKey,
  renderCard,
  handleDragOver,
  handleDropOnDay,
  openCreateForDay,
}: MonthGridProps) {
  return (
    <div className={c('calendar-grid') + ' ' + c('calendar-month')}>
      <div className={c('calendar-weekday-row')}>
        {weekdayLabels.map((wd) => (
          <div key={wd} className={c('calendar-weekday')}>
            {wd}
          </div>
        ))}
      </div>
      <div className={c('calendar-days')}>
        {days.map((day) => {
          const k = dayKey(day);
          const dayItems = byDay.get(k) || [];
          const isCurrentMonth = day.month() === anchor.month();
          const isToday = day.isSame(today, 'day');
          return (
            <div
              key={k}
              className={
                c('calendar-day') +
                (isCurrentMonth ? '' : ' is-outside') +
                (isToday ? ' is-today' : '') +
                (dragOverKey === k ? ' is-drag-over' : '')
              }
              onDragOver={(e) => handleDragOver(e, k)}
              onDragLeave={(e) => {
                const related = e.relatedTarget as Node | null;
                if (related && (e.currentTarget as Node).contains(related)) return;
                if (dragOverKey === k) setDragOverKey(null);
              }}
              onDrop={(e) => handleDropOnDay(e, day)}
              onClick={(e) => {
                if (e.target === e.currentTarget) openCreateForDay(day);
              }}
              onDblClick={() => openCreateForDay(day)}
            >
              <div
                className={c('calendar-day-header')}
                onClick={(e) => {
                  e.stopPropagation();
                  openCreateForDay(day);
                }}
              >
                <span className={c('calendar-day-number')}>{day.date()}</span>
                <span className={c('calendar-add-btn')} title="Add">
                  +
                </span>
              </div>
              <div
                className={c('calendar-day-items')}
                onClick={(e) => {
                  if (e.target === e.currentTarget) openCreateForDay(day);
                }}
              >
                {dayItems.map((entry) => renderCard(entry, { compact: true }))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Week grid (hour-based)
// ============================================================
interface WeekGridProps {
  days: moment.Moment[];
  byDay: Map<string, ItemEntry[]>;
  today: moment.Moment;
  weekdayLabels: string[];
  dragOverKey: string | null;
  setDragOverKey: (k: string | null) => void;
  renderCard: (entry: ItemEntry, opts?: { compact?: boolean }) => any;
  handleDragOver: (e: DragEvent, key?: string) => void;
  handleDropOnAllDay: (e: DragEvent, day: moment.Moment) => void;
  handleDropOnTimeSlot: (e: DragEvent, day: moment.Moment, columnEl: HTMLElement) => void;
  openCreateForDay: (day: moment.Moment, time?: string) => void;
}

function WeekGrid({
  days,
  byDay,
  today,
  weekdayLabels,
  dragOverKey,
  setDragOverKey,
  renderCard,
  handleDragOver,
  handleDropOnAllDay,
  handleDropOnTimeSlot,
  openCreateForDay,
}: WeekGridProps) {
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) out.push(h);
    return out;
  }, []);

  const totalHeight = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT;

  return (
    <div className={c('calendar-grid') + ' ' + c('calendar-week')}>
      {/* Header row: weekday labels + dates */}
      <div className={c('calendar-week-header')}>
        <div className={c('calendar-week-gutter')} />
        {days.map((day, i) => {
          const isToday = day.isSame(today, 'day');
          return (
            <div
              key={dayKey(day)}
              className={
                c('calendar-week-daycol-header') + (isToday ? ' is-today' : '')
              }
              onClick={() => openCreateForDay(day)}
            >
              <span className={c('calendar-week-weekday')}>{weekdayLabels[i]}</span>
              <span className={c('calendar-week-daynum')}>{day.date()}</span>
            </div>
          );
        })}
      </div>

      {/* All-day strip */}
      <div className={c('calendar-week-allday-row')}>
        <div className={c('calendar-week-gutter')}>
          <span className={c('calendar-week-allday-label')}>all-day</span>
        </div>
        {days.map((day) => {
          const k = dayKey(day);
          const allDay = (byDay.get(k) || []).filter((e) => getItemMinutes(e.item) === null);
          const dragKey = `allday-${k}`;
          return (
            <div
              key={k}
              className={
                c('calendar-week-allday-cell') +
                (dragOverKey === dragKey ? ' is-drag-over' : '')
              }
              onDragOver={(e) => handleDragOver(e, dragKey)}
              onDragLeave={(e) => {
                const related = e.relatedTarget as Node | null;
                if (related && (e.currentTarget as Node).contains(related)) return;
                if (dragOverKey === dragKey) setDragOverKey(null);
              }}
              onDrop={(e) => handleDropOnAllDay(e, day)}
              onClick={(e) => {
                if (e.target === e.currentTarget) openCreateForDay(day);
              }}
            >
              {allDay.map((entry) => renderCard(entry, { compact: true }))}
            </div>
          );
        })}
      </div>

      {/* Hour grid */}
      <div className={c('calendar-week-grid')}>
        {/* Hour gutter */}
        <div className={c('calendar-week-hour-gutter')} style={{ height: `${totalHeight}px` }}>
          {hours.map((h) => (
            <div
              key={h}
              className={c('calendar-week-hour-label')}
              style={{ top: `${(h - DAY_START_HOUR) * HOUR_HEIGHT}px` }}
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* Day columns with positioned cards */}
        {days.map((day) => {
          const k = dayKey(day);
          const timed = (byDay.get(k) || []).filter((e) => getItemMinutes(e.item) !== null);
          const dragKey = `timed-${k}`;
          const isToday = day.isSame(today, 'day');
          return (
            <DayColumn
              key={k}
              day={day}
              timed={timed}
              hours={hours}
              totalHeight={totalHeight}
              isToday={isToday}
              isDragOver={dragOverKey === dragKey}
              dragKey={dragKey}
              setDragOverKey={setDragOverKey}
              renderCard={renderCard}
              handleDragOver={handleDragOver}
              handleDropOnTimeSlot={handleDropOnTimeSlot}
              openCreateForDay={openCreateForDay}
            />
          );
        })}
      </div>
    </div>
  );
}

interface DayColumnProps {
  day: moment.Moment;
  timed: ItemEntry[];
  hours: number[];
  totalHeight: number;
  isToday: boolean;
  isDragOver: boolean;
  dragKey: string;
  setDragOverKey: (k: string | null) => void;
  renderCard: (entry: ItemEntry, opts?: { compact?: boolean }) => any;
  handleDragOver: (e: DragEvent, key?: string) => void;
  handleDropOnTimeSlot: (e: DragEvent, day: moment.Moment, columnEl: HTMLElement) => void;
  openCreateForDay: (day: moment.Moment, time?: string) => void;
}

function DayColumn({
  day,
  timed,
  hours,
  totalHeight,
  isToday,
  isDragOver,
  dragKey,
  setDragOverKey,
  renderCard,
  handleDragOver,
  handleDropOnTimeSlot,
  openCreateForDay,
}: DayColumnProps) {
  const colRef = useRef<HTMLDivElement>(null);

  const handleColumnClick = (e: MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const totalMinutes = Math.max(0, Math.round((y / HOUR_HEIGHT) * 60));
    const snapped = Math.min(24 * 60 - 15, Math.round(totalMinutes / 15) * 15);
    const h = Math.floor(snapped / 60);
    const min = snapped % 60;
    const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    openCreateForDay(day, timeStr);
  };

  return (
    <div
      ref={colRef}
      className={
        c('calendar-week-daycol') +
        (isToday ? ' is-today' : '') +
        (isDragOver ? ' is-drag-over' : '')
      }
      style={{ height: `${totalHeight}px` }}
      onDragOver={(e) => handleDragOver(e, dragKey)}
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        if (related && (e.currentTarget as Node).contains(related)) return;
        setDragOverKey(null);
      }}
      onDrop={(e) => handleDropOnTimeSlot(e, day, colRef.current!)}
      onClick={handleColumnClick}
    >
      {/* Hour gridlines */}
      {hours.map((h) => (
        <div
          key={h}
          className={c('calendar-week-hour-line')}
          style={{ top: `${(h - DAY_START_HOUR) * HOUR_HEIGHT}px` }}
        />
      ))}
      {/* Cards positioned by time */}
      {timed.map((entry) => {
        const minutes = getItemMinutes(entry.item)!;
        const top = ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
        return (
          <div
            key={entry.item.id}
            className={c('calendar-week-event')}
            style={{ top: `${top}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            {renderCard(entry, { compact: true })}
          </div>
        );
      })}
    </div>
  );
}
