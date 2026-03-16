import React, { useState } from 'react'
import UploadPage from './components/UploadPage.jsx'
import EditorPage from './components/EditorPage.jsx'

export default function App() {
  const [page, setPage] = useState('upload') // 'upload' | 'editor'
  const [videoId, setVideoId] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [subtitles, setSubtitles] = useState([])
  const [duration, setDuration] = useState(0)

  function handleUploadComplete({ videoId, videoUrl, subtitles, duration }) {
    setVideoId(videoId)
    setVideoUrl(videoUrl)
    setSubtitles(subtitles)
    setDuration(duration)
    setPage('editor')
  }

  function handleBack() {
    setPage('upload')
    setVideoId(null)
    setVideoUrl(null)
    setSubtitles([])
    setDuration(0)
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
          onBack={handleBack}
        />
      )}
    </div>
  )
}
