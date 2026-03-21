'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CategorizeByUpload() {
  const router = useRouter()
  useEffect(() => { router.replace('/categorize') }, [router])
  return null
}
