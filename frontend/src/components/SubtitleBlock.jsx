import React, { useCallback } from 'react'
import { secondsToSrtTime } from '../utils/srtExporter.js'
import { srtTimeToSeconds } from '../utils/srtParser.js'

export default function SubtitleBlock({ subtitle, isSelected, isActive, onChange, onDelete, onSelect }) {
  const handleTimeChange = useCallback((field, value) => {
    // Try to parse the time string to seconds
    try {
      // Accept HH:MM:SS,mmm or HH:MM:SS.mmm or plain seconds
      let seconds
      if (/^\d+(\.\d+)?$/.test(value.trim())) {
        seconds = parseFloat(value)
      } else {
        seconds = srtTimeToSeconds(value)
      }
      if (!isNaN(seconds) && seconds >= 0) {
        if (field === 'start' && seconds >= subtitle.end) return
        if (field === 'end' && seconds <= subtitle.start) return
        onChange({ ...subtitle, [field]: seconds })
      }
    } catch {
      // ignore invalid input during typing
    }
  }, [subtitle, onChange])

  const handleTextChange = useCallback((e) => {
    onChange({ ...subtitle, text: e.target.value })
  }, [subtitle, onChange])

  return (
    <div
      className={`subtitle-block${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`}
      data-id={subtitle.id}
      onClick={onSelect}
    >
      <div className="subtitle-block-header">
        <span className="subtitle-block-id">#{subtitle.id}</span>
        <div className="subtitle-block-times">
          <input
            type="text"
            defaultValue={secondsToSrtTime(subtitle.start)}
            key={`start-${subtitle.id}-${subtitle.start}`}
            onBlur={(e) => handleTimeChange('start', e.target.value)}
            onClick={(e) => e.stopPropagation()}
            title="Start time (HH:MM:SS,mmm)"
          />
          <span>→</span>
          <input
            type="text"
            defaultValue={secondsToSrtTime(subtitle.end)}
            key={`end-${subtitle.id}-${subtitle.end}`}
            onBlur={(e) => handleTimeChange('end', e.target.value)}
            onClick={(e) => e.stopPropagation()}
            title="End time (HH:MM:SS,mmm)"
          />
        </div>
        <button
          className="btn-danger"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          tabIndex={-1}
          title="Delete subtitle"
        >
          ✕
        </button>
      </div>
      <textarea
        className="subtitle-block-text"
        value={subtitle.text}
        onChange={handleTextChange}
        onClick={(e) => e.stopPropagation()}
        rows={2}
      />
    </div>
  )
}
