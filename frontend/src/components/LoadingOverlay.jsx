import React, { useEffect, useRef } from 'react'
import { secondsToSrtTime } from '../utils/srtExporter.js'

export default function LoadingOverlay({ title, status, progress, segments }) {
  const previewRef = useRef(null)

  // Auto-scroll preview to bottom as new segments arrive
  useEffect(() => {
    if (previewRef.current) {
      previewRef.current.scrollTop = previewRef.current.scrollHeight
    }
  }, [segments])

  return (
    <div className="loading-overlay">
      <div className="loading-title">{title || 'Processing...'}</div>
      <div className="loading-status">{status || ''}</div>

      <div className="progress-bar-container">
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.max(0, Math.min(100, progress || 0))}%` }}
        />
      </div>

      {segments && segments.length > 0 && (
        <div className="loading-preview" ref={previewRef}>
          {segments.map((seg, i) => (
            <div key={seg.id ?? i} className="loading-preview-item">
              <div className="loading-preview-time">
                {secondsToSrtTime(seg.start)} → {secondsToSrtTime(seg.end)}
              </div>
              <div>{seg.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
