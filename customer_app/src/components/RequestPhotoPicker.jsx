import { useEffect, useId, useRef, useState } from 'react'
import {
  MAX_REQUEST_PHOTOS,
  validatePhotoFile,
} from '../api/photos'

function FilePreview({ file, number }) {
  const imageRef = useRef(null)

  useEffect(() => {
    const image = imageRef.current
    const url = URL.createObjectURL(file)
    if (image) {
      image.src = url
    }
    return () => {
      if (image) {
        image.removeAttribute('src')
      }
      URL.revokeObjectURL(url)
    }
  }, [file])

  return (
    <img
      ref={imageRef}
      alt={`Selected work photo ${number}`}
      style={{
        width: '100%',
        height: 140,
        objectFit: 'cover',
        borderRadius: 8,
        background: '#eef3f8',
      }}
    />
  )
}

export default function RequestPhotoPicker({
  files,
  onChange,
  disabled = false,
}) {
  const inputId = useId()
  const [error, setError] = useState('')

  function selectFiles(event, replaceIndex) {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    if (!selected.length) {
      return
    }

    try {
      selected.forEach(validatePhotoFile)
      const next = [...files]

      if (replaceIndex !== undefined) {
        next[replaceIndex] = selected[0]
      } else {
        next.push(...selected)
      }

      if (next.length > MAX_REQUEST_PHOTOS) {
        throw new Error('You can select up to five work photos.')
      }

      setError('')
      onChange(next)
    } catch (err) {
      setError(err.message || 'Unable to select these images.')
    }
  }

  function removeFile(index) {
    setError('')
    onChange(files.filter((_, position) => position !== index))
  }

  return (
    <fieldset
      disabled={disabled}
      style={{
        border: '1px solid #dce5ee',
        borderRadius: 12,
        padding: 16,
        margin: '20px 0',
        minWidth: 0,
      }}
    >
      <legend style={{ fontWeight: 700 }}>Work photos ? optional</legend>
      <p style={{ marginTop: 0 }}>
        Show the work so your technician can understand it.
        Choose up to five JPEG, PNG or WebP images, each up to 5 MiB.
      </p>

      <label htmlFor={inputId}>Add work photos</label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled || files.length >= MAX_REQUEST_PHOTOS}
        onChange={(event) => selectFiles(event)}
        style={{ display: 'block', margin: '8px 0 12px', maxWidth: '100%' }}
      />

      <p aria-live="polite">{files.length} / {MAX_REQUEST_PHOTOS} selected</p>
      {error && <p role="alert" style={{ color: '#b42318' }}>{error}</p>}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 12,
      }}>
        {files.map((file, index) => (
          <div key={index} style={{
            padding: 10,
            border: '1px solid #dce5ee',
            borderRadius: 10,
            minWidth: 0,
          }}>
            <FilePreview file={file} number={index + 1} />
            <p style={{ overflowWrap: 'anywhere', fontSize: 13 }}>
              {file.name}
            </p>
            <button type="button" onClick={() => removeFile(index)}>
              Remove photo {index + 1}
            </button>
            <label
              htmlFor={`${inputId}-replace-${index}`}
              style={{ display: 'block', marginTop: 10 }}
            >
              Replace photo {index + 1}
            </label>
            <input
              id={`${inputId}-replace-${index}`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => selectFiles(event, index)}
              style={{ display: 'block', marginTop: 6, width: '100%' }}
            />
          </div>
        ))}
      </div>
    </fieldset>
  )
}
