import React, { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'

function regionColor(index, selected) {
  const hue = (index * 47) % 360
  const alpha = selected ? 0.65 : 0.4
  return `hsla(${hue}, 70%, 60%, ${alpha})`
}

export default function Waveform({
  audioUrl,
  videoRef,
  subtitles,
  selectedId,
  onSelectSubtitle,
  onSubtitleChange,
  duration,
  zoomLevel,
}) {
  const containerRef = useRef(null)
  const wsRef = useRef(null)
  const regionsPluginRef = useRef(null)
  const isSyncingRef = useRef(false)
  const isReadyRef = useRef(false)
  const subtitlesRef = useRef(subtitles)
  const zoomLevelRef = useRef(zoomLevel)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => { subtitlesRef.current = subtitles }, [subtitles])
  useEffect(() => { zoomLevelRef.current = zoomLevel }, [zoomLevel])

  // Initialize WaveSurfer once per audioUrl
  useEffect(() => {
    setIsReady(false)
    if (!containerRef.current || !audioUrl) return

    const regionsPlugin = RegionsPlugin.create()
    regionsPluginRef.current = regionsPlugin

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4a4a5a',
      progressColor: '#4a9eff',
      cursorColor: '#ffffff',
      cursorWidth: 2,
      height: 80,
      normalize: true,
      interact: true,
      autoScroll: true,
      autoCenter: true,
      plugins: [
        TimelinePlugin.create({
          height: 20,
          timeInterval: 5,
          primaryLabelInterval: 10,
          style: { fontSize: '10px', color: '#888888' },
        }),
        regionsPlugin,
      ],
    })

    wsRef.current = ws

    ws.on('ready', () => {
      isReadyRef.current = true
      setIsReady(true)
      ws.zoom(zoomLevelRef.current)
    })

    ws.load(audioUrl)

    // Waveform click/drag -> seek video
    ws.on('interaction', () => {
      const video = videoRef.current
      if (video && !isSyncingRef.current) {
        isSyncingRef.current = true
        video.currentTime = ws.getCurrentTime()
        isSyncingRef.current = false
      }
    })

    // Region click -> select subtitle + seek video
    regionsPlugin.on('region-clicked', (region, e) => {
      e.stopPropagation()
      const subId = parseInt(region.id, 10)
      if (!isNaN(subId)) {
        onSelectSubtitle(subId)
        const video = videoRef.current
        if (video) video.currentTime = region.start
        const dur = ws.getDuration()
        if (dur > 0) ws.seekTo(region.start / dur)
      }
    })

    // Region drag/resize -> update subtitle timing
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
      isReadyRef.current = false
      ws.destroy()
      wsRef.current = null
      regionsPluginRef.current = null
    }
  }, [audioUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Video time -> waveform cursor sync
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => {
      const ws = wsRef.current
      if (!ws || isSyncingRef.current) return
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

  // Apply zoom level when it changes
  useEffect(() => {
    if (wsRef.current && isReadyRef.current) {
      wsRef.current.zoom(zoomLevel)
    }
  }, [zoomLevel])

  // Render/update subtitle regions — only after WaveSurfer knows the duration
  useEffect(() => {
    const regionsPlugin = regionsPluginRef.current
    if (!regionsPlugin || !isReady) return

    regionsPlugin.clearRegions()

    subtitles.forEach((sub, index) => {
      const isSelected = sub.id === selectedId

      // Use a DOM element for content so we can control text overflow
      const content = document.createElement('div')
      content.style.cssText = [
        'overflow:hidden',
        'text-overflow:ellipsis',
        'white-space:nowrap',
        'font-size:10px',
        'padding:1px 3px',
        'color:rgba(255,255,255,0.95)',
        'text-shadow:0 1px 2px rgba(0,0,0,0.8)',
        'pointer-events:none',
        'width:100%',
        'box-sizing:border-box',
      ].join(';')
      content.textContent = sub.text.split('\n')[0]

      regionsPlugin.addRegion({
        id: String(sub.id),
        start: sub.start,
        end: sub.end,
        content,
        color: regionColor(index, isSelected),
        drag: true,
        resize: true,
      })
    })
  }, [subtitles, selectedId, isReady])

  return (
    <div className="waveform-wrapper">
      <div ref={containerRef} />
    </div>
  )
}
