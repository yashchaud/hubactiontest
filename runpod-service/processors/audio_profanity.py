"""
Audio Profanity Detector
Uses speech-to-text and profanity filtering for audio streams
"""

import os
import logging
import asyncio
import io
from typing import List, Dict, Optional
import numpy as np

logger = logging.getLogger(__name__)


class AudioProfanityDetector:
    """Detects profanity in audio streams using transcription"""

    def __init__(self):
        self.whisper_model = None
        self.profanity_filter = None
        self._load_models()
        logger.info("AudioProfanityDetector initialized")

    def _load_models(self):
        """Load Whisper and profanity filter models"""
        try:
            # Load better-profanity (lightweight, fast)
            from better_profanity import profanity
            profanity.load_censor_words()
            self.profanity_filter = profanity

            logger.info("Profanity filter loaded")

            # Load Whisper for transcription (optional, can use cloud API instead)
            whisper_enabled = os.getenv('ENABLE_LOCAL_WHISPER', 'false').lower() == 'true'

            if whisper_enabled:
                try:
                    import whisper
                    model_size = os.getenv('WHISPER_MODEL_SIZE', 'base')
                    logger.info(f"Loading Whisper model ({model_size})...")
                    self.whisper_model = whisper.load_model(model_size)
                    logger.info("Whisper model loaded")
                except Exception as e:
                    logger.warning(f"Could not load Whisper locally: {e}")
                    logger.info("Will use cloud API for transcription if API key is provided")
                    self.whisper_model = None
            else:
                logger.info("Local Whisper disabled, will use cloud API if available")

        except Exception as e:
            logger.error(f"Error loading audio models: {e}")
            logger.warning("Audio profanity detection will be limited")

    def _extract_audio_from_bytes(self, audio_bytes: bytes) -> Optional[np.ndarray]:
        """Extract audio array from bytes"""
        try:
            import soundfile as sf

            # Read audio from bytes
            audio_data, sample_rate = sf.read(io.BytesIO(audio_bytes))

            # Convert to mono if stereo
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)

            return audio_data

        except Exception as e:
            logger.error(f"Error extracting audio: {e}")
            return None

    async def _transcribe_local(self, audio_data: np.ndarray) -> Optional[Dict]:
        """Transcribe audio using local Whisper model"""
        if self.whisper_model is None:
            return None

        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                self.whisper_model.transcribe,
                audio_data
            )

            return result

        except Exception as e:
            logger.error(f"Error in local transcription: {e}")
            return None

    async def _transcribe_cloud(self, audio_bytes: bytes) -> Optional[Dict]:
        """Transcribe audio using OpenAI Whisper API"""
        api_key = os.getenv('OPENAI_API_KEY')

        if not api_key:
            logger.warning("OpenAI API key not set, cannot use cloud transcription")
            return None

        try:
            import openai
            openai.api_key = api_key

            # Create temporary file-like object
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = "audio.wav"

            # Transcribe using OpenAI API
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: openai.Audio.transcribe("whisper-1", audio_file)
            )

            # Convert to Whisper-like format
            return {
                "text": response["text"],
                "segments": []  # Cloud API doesn't provide detailed segments
            }

        except Exception as e:
            logger.error(f"Error in cloud transcription: {e}")
            return None

    def _detect_profanity_in_text(
        self,
        text: str,
        custom_profanity_list: List[str] = None
    ) -> List[Dict]:
        """Detect profanity in transcribed text"""
        detections = []

        if not text:
            return detections

        # Check with better-profanity
        if self.profanity_filter:
            contains_profanity = self.profanity_filter.contains_profanity(text)

            if contains_profanity:
                # Censor to find what words were profane
                censored = self.profanity_filter.censor(text)

                detections.append({
                    "type": "audio_profanity",
                    "original_text": text,
                    "censored_text": censored,
                    "method": "better_profanity",
                    "confidence": 0.9
                })

        # Check custom profanity list
        if custom_profanity_list:
            text_lower = text.lower()

            for profane_word in custom_profanity_list:
                if profane_word.lower() in text_lower:
                    detections.append({
                        "type": "audio_profanity",
                        "matched_word": profane_word,
                        "original_text": text,
                        "method": "custom_list",
                        "confidence": 1.0
                    })

        return detections

    def _extract_timestamps(self, transcription: Dict) -> List[Dict]:
        """Extract timestamps from Whisper transcription"""
        timestamps = []

        if 'segments' in transcription:
            for segment in transcription['segments']:
                timestamps.append({
                    "start": segment.get('start', 0),
                    "end": segment.get('end', 0),
                    "text": segment.get('text', '')
                })

        return timestamps

    async def detect(
        self,
        audio_bytes: bytes,
        confidence_threshold: float = 0.8,
        profanity_list: List[str] = None
    ) -> List[Dict]:
        """
        Detect profanity in audio chunk

        Args:
            audio_bytes: Audio data in bytes
            confidence_threshold: Minimum confidence for detection
            profanity_list: Custom list of profane words

        Returns:
            List of profanity detections with timestamps
        """
        try:
            # Extract audio data
            audio_data = self._extract_audio_from_bytes(audio_bytes)

            if audio_data is None:
                return []

            # Transcribe audio (try local first, then cloud)
            transcription = await self._transcribe_local(audio_data)

            if transcription is None:
                transcription = await self._transcribe_cloud(audio_bytes)

            if transcription is None:
                logger.warning("Could not transcribe audio")
                return []

            # Get transcribed text
            text = transcription.get('text', '')

            if not text:
                return []

            logger.debug(f"Transcribed: {text}")

            # Detect profanity in text
            detections = self._detect_profanity_in_text(text, profanity_list)

            # Add timestamps if available
            timestamps = self._extract_timestamps(transcription)

            for detection in detections:
                detection['timestamps'] = timestamps
                detection['should_bleep'] = detection['confidence'] >= confidence_threshold

            if detections:
                logger.info(f"Audio profanity detected: {len(detections)} instance(s)")

            return detections

        except Exception as e:
            logger.error(f"Error in audio profanity detection: {e}")
            return []

    async def detect_streaming(
        self,
        audio_stream,
        chunk_duration: float = 5.0,
        profanity_list: List[str] = None
    ):
        """
        Detect profanity in streaming audio (generator function)

        Args:
            audio_stream: Audio stream iterator
            chunk_duration: Duration of each chunk in seconds
            profanity_list: Custom profanity list

        Yields:
            Profanity detections for each chunk
        """
        async for audio_chunk in audio_stream:
            detections = await self.detect(audio_chunk, profanity_list=profanity_list)
            yield detections

    def add_custom_words(self, words: List[str]):
        """Add custom words to profanity filter"""
        if self.profanity_filter:
            for word in words:
                self.profanity_filter.add_censor_words([word])
            logger.info(f"Added {len(words)} custom profane words")

    def remove_words(self, words: List[str]):
        """Remove words from profanity filter (whitelist)"""
        if self.profanity_filter:
            # better-profanity doesn't have a remove method, so we'd need to maintain a custom list
            logger.warning("Word removal not supported in better-profanity")
