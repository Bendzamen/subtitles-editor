import React, { useState } from 'react'
import UploadPage from './components/UploadPage.jsx'
import EditorPage from './components/EditorPage.jsx'

export default function App() {
  const [page, setPage] = useState('upload') // 'upload' | 'editor'
  const [videoId, setVideoId] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [subtitles, setSubtitles] = useState([])
  const [duration, setDuration] = useState(0)
  const [exportFileName, setExportFileName] = useState('subtitles.VibeSubs.srt')

  function handleUploadComplete({ videoId, videoUrl, subtitles, duration, exportFileName }) {
    setVideoId(videoId)
    setVideoUrl(videoUrl)
    setSubtitles(subtitles)
    setDuration(duration)
    setExportFileName(exportFileName)
    setPage('editor')
  }

  function handleBack() {
    setPage('upload')
    setVideoId(null)
    setVideoUrl(null)
    setSubtitles([])
    setDuration(0)
    setExportFileName('subtitles.VibeSubs.srt')
  }

  return (
    <div className="app">
      {page === 'upload' && (
        <UploadPage onComplete={handleUploadComplete} />
      )}
      {page === 'editor' && (
        <EditorPage
          videoId={videoId}
          videoUrl={videoUrl}
          subtitles={subtitles}
          setSubtitles={setSubtitles}
          duration={duration}
          exportFileName={exportFileName}
          onBack={handleBack}
        />
      )}
    </div>
  )
}
