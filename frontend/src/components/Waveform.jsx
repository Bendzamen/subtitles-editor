import React, { useEffect, useRef, useCallback } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'

// Generate a semi-transparent color for subtitle regions
function regionColor(index, selected) {
  const hue = (index * 47) % 360
  const alpha = selected ? 0.55 : 0.35
  return `hsla(${hue}, 70%, 60%, ${alpha})`
}

export default function Waveform({
  videoUrl,
  videoRef,
  subtitles,
  selectedId,
  onSelectSubtitle,
  onSubtitleChange,
  duration,
}) {
  const containerRef = useRef(null)
  const wsRef = useRef(null)
  const regionsPluginRef = useRef(null)
  const isSyncingRef = useRef(false)
  const subtitlesRef = useRef(subtitles)
  const selectedIdRef = useRef(selectedId)

  // Keep refs current
  useEffect(() => { subtitlesRef.current = subtitles }, [subtitles])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !videoUrl) return

    const regionsPlugin = RegionsPlugin.create()
    regionsPluginRef.current = regionsPlugin

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4a4a5a',
      progressColor: '#4a9eff',
      cursorColor: '#ffffff',
      height: 80,
      normalize: true,
      interact: true,
      plugins: [
        TimelinePlugin.create({
          height: 20,
          timeInterval: 5,
          primaryLabelInterval: 10,
          style: {
            fontSize: '10px',
            color: '#888888',
          },
        }),
        regionsPlugin,
      ],
    })

    wsRef.current = ws

    ws.load(videoUrl)

    // Sync waveform seek -> video
    ws.on('seek', (progress) => {
      if (isSyncingRef.current) return
      const video = videoRef.current
      if (video) {
        isSyncingRef.current = true
        video.currentTime = progress * ws.getDuration()
        isSyncingRef.current = false
      }
    })

    ws.on('interaction', () => {
      const video = videoRef.current
      if (video && !isSyncingRef.current) {
        isSyncingRef.current = true
        video.currentTime = ws.getCurrentTime()
        isSyncingRef.current = false
      }
    })

    // Region click -> select subtitle
    regionsPlugin.on('region-clicked', (region, e) => {
      e.stopPropagation()
      const subId = parseInt(region.id, 10)
      if (!isNaN(subId)) {
        onSelectSubtitle(subId)
        // Seek video to region start
        const video = videoRef.current
        if (video) {
          video.currentTime = region.start
        }
        ws.seekTo(region.start / ws.getDuration())
      }
    })

    // Region updated (drag/resize) -> update subtitle
    regionsPlugin.on('region-updated', (region) => {
      const subId = parseInt(region.id, 10)
      if (!isNaN(subId)) {
        const sub = subtitlesRef.current.find(s => s.id === subId)
        if (sub) {
          onSubtitleChange({
            ...sub,
            start: parseFloat(region.start.toFixed(3)),
            end: parseFloat(region.end.toFixed(3)),
          })
        }
      }
    })

    return () => {
      ws.destroy()
      wsRef.current = null
      regionsPluginRef.current = null
    }
  }, [videoUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync video time -> waveform position
  useEffect(() => {
    const video = videoRef.current
    const ws = wsRef.current
    if (!video || !ws) return

    const onTimeUpdate = () => {
      if (isSyncingRef.current) return
      const dur = ws.getDuration()
      if (dur > 0) {
        isSyncingRef.current = true
        ws.seekTo(video.currentTime / dur)
        isSyncingRef.current = false
      }
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [videoRef])

  // Render/update subtitle regions when subtitles or selectedId change
  useEffect(() => {
    const regionsPlugin = regionsPluginRef.current
    if (!regionsPlugin) return

    // Clear all existing regions
    regionsPlugin.clearRegions()

    // Add a region for each subtitle
    subtitles.forEach((sub, index) => {
      const isSelected = sub.id === selectedId
      regionsPlugin.addRegion({
        id: String(sub.id),
        start: sub.start,
        end: sub.end,
        content: sub.text.split('\n')[0].slice(0, 30) + (sub.text.length > 30 ? '…' : ''),
        color: regionColor(index, isSelected),
        drag: true,
        resize: true,
      })
    })
  }, [subtitles, selectedId])

  return (
    <div className="waveform-wrapper">
      <div ref={containerRef} id="waveform" />
    </div>
  )
}
