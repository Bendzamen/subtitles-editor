import React, { useRef, useState, useCallback } from 'react'
import Waveform from './Waveform.jsx'
import SubtitleBlock from './SubtitleBlock.jsx'
import { downloadSRT } from '../utils/srtExporter.js'

export default function EditorPage({
  videoId,
  videoUrl,
  subtitles,
  setSubtitles,
  duration,
  onBack,
}) {
  const videoRef = useRef(null)
  const subtitleListRef = useRef(null)
  const [selectedId, setSelectedId] = useState(null)

  const handleSelectSubtitle = useCallback((id) => {
    setSelectedId(id)
    // Scroll to selected subtitle in the list
    setTimeout(() => {
      const el = document.querySelector(`.subtitle-block[data-id="${id}"]`)
      if (el && subtitleListRef.current) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 50)
  }, [])

  const handleSubtitleChange = useCallback((updated) => {
    setSubtitles(prev =>
      prev.map(s => s.id === updated.id ? updated : s)
    )
  }, [setSubtitles])

  const handleSubtitleDelete = useCallback((id) => {
    setSubtitles(prev => {
      const filtered = prev.filter(s => s.id !== id)
      // Re-number
      return filtered.map((s, i) => ({ ...s, id: i + 1 }))
    })
    if (selectedId === id) setSelectedId(null)
  }, [selectedId, setSubtitles])

  const handleAddSubtitle = useCallback(() => {
    // Add a new subtitle at the current video time or at the end
    const currentTime = videoRef.current?.currentTime ?? 0
    const newStart = currentTime
    const newEnd = currentTime + 2

    setSubtitles(prev => {
      const newId = prev.length > 0 ? Math.max(...prev.map(s => s.id)) + 1 : 1
      const newSub = { id: newId, start: newStart, end: newEnd, text: 'New subtitle' }

      // Insert in chronological order
      const inserted = [...prev, newSub].sort((a, b) => a.start - b.start)
      // Re-number after sort
      return inserted.map((s, i) => ({ ...s, id: i + 1 }))
    })
    setSelectedId(prev => {
      // Select the new subtitle after state update
      setTimeout(() => {
        const lastSubEl = subtitleListRef.current?.lastElementChild
        lastSubEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 100)
      return null
    })
  }, [setSubtitles])

  const handleExport = useCallback(() => {
    downloadSRT(subtitles, 'subtitles.srt')
  }, [subtitles])

  return (
    <div className="editor-page">
      {/* Toolbar */}
      <div className="editor-toolbar">
        <button className="btn-secondary" onClick={onBack} title="Back to upload">
          ← Back
        </button>
        <span className="editor-toolbar-title">Subtitle Editor</span>
        <button className="btn-secondary" onClick={handleAddSubtitle} title="Add subtitle at current time">
          + Add Subtitle
        </button>
        <button className="btn-primary" onClick={handleExport} title="Download SRT file">
          Export SRT
        </button>
      </div>

      {/* Main layout: left (video + waveform) + right (subtitle list) */}
      <div className="editor-main">
        {/* LEFT: video + waveform */}
        <div className="editor-left">
          <div className="video-container">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
            />
          </div>
          <div className="waveform-container">
            <Waveform
              videoUrl={videoUrl}
              videoRef={videoRef}
              subtitles={subtitles}
              selectedId={selectedId}
              onSelectSubtitle={handleSelectSubtitle}
              onSubtitleChange={handleSubtitleChange}
              duration={duration}
            />
          </div>
        </div>

        {/* RIGHT: subtitle list */}
        <div className="editor-right">
          <div className="subtitle-list-header">
            <span>Subtitles ({subtitles.length})</span>
          </div>
          <div className="subtitle-list" ref={subtitleListRef}>
            {subtitles.map(sub => (
              <div key={sub.id} data-id={sub.id}>
                <SubtitleBlock
                  subtitle={sub}
                  isSelected={sub.id === selectedId}
                  onChange={handleSubtitleChange}
                  onDelete={() => handleSubtitleDelete(sub.id)}
                  onSelect={() => {
                    handleSelectSubtitle(sub.id)
                    // Seek video to subtitle start
                    if (videoRef.current) {
                      videoRef.current.currentTime = sub.start
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
