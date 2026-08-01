'use client';

import { useCallback, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { ImagePlus, Send, Square, WandSparkles, X } from 'lucide-react';
import type { ReedyImageAttachment } from '../store/reedyStore';

/**
 * Minimal Skill shape the composer's chip row renders. The full Skill
 * type (Phase 5 — separate PR) is a strict superset; the composer only
 * touches these fields, so we declare locally to avoid a cross-branch
 * dependency.
 */
export interface ComposerSkill {
  id: string;
  name: string;
  description: string;
}
type Skill = ComposerSkill;

/**
 * Multi-line input + send/abort button + skill chip row (Phase 4.2.h).
 *
 * Keyboard:
 *   - Cmd/Ctrl + Enter → send
 *   - Esc              → abort if a turn is running, otherwise blur
 *   - Enter alone      → newline (per the plan's UX)
 */
export function Composer({
  isRunning,
  onSend,
  onAbort,
  disabled,
  skills,
  activeSkillId,
  onSkillSelect,
}: {
  isRunning: boolean;
  onSend: (text: string, attachments: ReedyImageAttachment[]) => void;
  onAbort: () => void;
  disabled?: boolean;
  skills?: Skill[];
  activeSkillId?: string | null;
  onSkillSelect?: (id: string | null) => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<ReedyImageAttachment[]>([]);

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0 && images.length === 0) return;
    onSend(trimmed, images);
    setText('');
    setImages([]);
  }, [text, images, onSend]);

  const handleImageChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    const next = await Promise.all(files.map(async (file) => ({
      type: 'image' as const,
      data: await readImageData(file),
      mimeType: file.type || 'image/jpeg',
      filename: file.name,
    })));
    setImages((current) => [...current, ...next]);
    event.target.value = '';
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!disabled && !isRunning) send();
    } else if (e.key === 'Escape') {
      if (isRunning) {
        e.preventDefault();
        onAbort();
      }
    }
  };

  return (
    <div className='reedy-agent-composer border-base-content/10 bg-base-100 flex flex-col gap-2 border-t p-2'>
      {skills && skills.length > 0 && (
        <div className='flex flex-wrap items-center gap-1'>
          <span className='text-base-content/40 me-1 text-[10px] uppercase'>Skill</span>
          <button
            type='button'
            className={chipClass(activeSkillId == null)}
            onClick={() => onSkillSelect?.(null)}
          >
            None
          </button>
          {skills.map((s) => (
            <button
              key={s.id}
              type='button'
              className={chipClass(activeSkillId === s.id)}
              onClick={() => onSkillSelect?.(s.id)}
              title={s.description}
            >
              <WandSparkles className='size-3' />
              {s.name}
            </button>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {images.map((image, index) => (
            <div key={index} className='relative'>
              <img src={image.data} alt={image.filename || 'Attached image'} className='size-14 rounded border object-cover' />
              <button
                type='button'
                className='bg-base-content text-base-100 absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-full'
                onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                aria-label='Remove image'
                title='Remove image'
              >
                <X className='size-3' />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className='border-base-content/10 bg-base-200/40 eink-bordered flex items-end gap-1 rounded-md border px-2 py-1.5'>
        <label className='text-base-content/60 hover:bg-base-300 mb-0.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full' title='Attach image'>
          <ImagePlus className='size-4' />
          <input type='file' accept='image/*' multiple className='sr-only' onChange={handleImageChange} disabled={disabled || isRunning} />
        </label>
        <textarea
          className='text-base-content placeholder:text-base-content/40 max-h-40 min-h-[1.75rem] flex-1 resize-none bg-transparent text-sm outline-none'
          rows={1}
          placeholder='Ask Reedy about this book…'
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {isRunning ? (
          <button
            type='button'
            className='btn btn-primary btn-sm size-7 min-h-0 rounded-full p-0'
            onClick={onAbort}
            title='Stop (Esc)'
            aria-label='Stop'
          >
            <Square className='size-3' />
          </button>
        ) : (
          <button
            type='button'
            className='btn btn-primary btn-sm size-7 min-h-0 rounded-full p-0 disabled:opacity-40'
            onClick={send}
            disabled={disabled || (text.trim().length === 0 && images.length === 0)}
            title='Send (⌘/Ctrl + Enter)'
            aria-label='Send'
          >
            <Send className='size-3' />
          </button>
        )}
      </div>
    </div>
  );
}

function readImageData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

function chipClass(active: boolean): string {
  return [
    'border-base-content/10 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
    active ? 'bg-primary text-primary-content border-primary' : 'bg-base-100 hover:bg-base-200',
  ].join(' ');
}
