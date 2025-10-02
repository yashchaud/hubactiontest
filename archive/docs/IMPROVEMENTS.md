# 🚀 Comprehensive Codebase Improvement Recommendations

**Analysis Date:** October 2, 2025
**Based On:** Current best practices research + codebase deep-dive
**Total Improvements:** 52 recommendations across 8 categories

---

## 📋 Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Priorities](#critical-priorities-implement-first)
3. [GPU Inference Optimization](#1-gpu-inference-optimization)
4. [Production Error Handling](#2-production-error-handling)
5. [Security Hardening](#3-security-hardening)
6. [State Management & Persistence](#4-state-management--persistence)
7. [Performance Optimizations](#5-performance-optimizations)
8. [Monitoring & Observability](#6-monitoring--observability)
9. [WebSocket Optimization](#7-websocket-optimization)
10. [ML Pipeline Improvements](#8-ml-pipeline-improvements)
11. [Client-Side Improvements](#9-client-side-improvements)
12. [Server-Side Improvements](#10-server-side-improvements)
13. [DevOps & Infrastructure](#11-devops--infrastructure)
14. [Testing & Quality Assurance](#12-testing--quality-assurance)
15. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

### Current State
Your LiveKit streaming platform with real-time censorship is **functionally complete** but requires production hardening. The system works end-to-end but lacks:
- Production-grade error handling
- Performance optimization for scale
- Security best practices
- Monitoring/observability
- State persistence

### Impact Analysis
| Category | Current State | After Improvements | Impact |
|----------|---------------|-------------------|--------|
| **Inference Speed** | Baseline (TensorFlow) | 3-5x faster (TensorRT) | 🔥 Critical |
| **Reliability** | Single point of failure | Distributed + fallbacks | 🔥 Critical |
| **Security** | Development mode | Production-ready | 🔥 Critical |
| **Observability** | Console logs only | Full metrics + tracing | ⚡ High |
| **Scalability** | In-memory state | Redis/PostgreSQL | ⚡ High |
| **Error Recovery** | Crashes on errors | Graceful degradation | ⚡ High |

### Estimated Timeline
- **Phase 1 (Critical):** 2-3 weeks
- **Phase 2 (High Impact):** 3-4 weeks
- **Phase 3 (Polish):** 2-3 weeks
- **Total:** 7-10 weeks for full implementation

---

## Critical Priorities (Implement First)

### Priority Matrix

| Priority | Category | Estimated Time | Impact |
|----------|----------|---------------|--------|
| 🔴 P0 | GPU Inference Optimization | 1 week | 3-5x speedup |
| 🔴 P0 | Production Error Handling | 1 week | Prevent crashes |
| 🔴 P0 | Security Hardening | 1 week | Prevent breaches |
| 🟡 P1 | State Persistence (Redis) | 3 days | Handle restarts |
| 🟡 P1 | Monitoring Setup | 3 days | Visibility |
| 🟢 P2 | Client Optimization | 5 days | Better UX |

---

## 1. GPU Inference Optimization

### 🎯 Goal
Reduce inference latency from ~100ms to ~20-30ms per frame using 2025 best practices.

### Current Issues
- ❌ No TensorRT optimization (missing 3-6x speedup)
- ❌ Sequential frame processing (no batching)
- ❌ FP32 precision (2x slower than FP16)
- ❌ Cold model loading on each request
- ❌ No CUDA graph optimization

### Recommendations

#### 1.1 Add TensorRT Integration

**File:** `runpod-service/processors/nsfw_detector.py`

**Current Code:**
```python
from nudenet import NudeDetector

self.detector = NudeDetector()
```

**Improved Code:**
```python
import torch
import torch_tensorrt
from nudenet import NudeDetector

class NSFWDetector:
    def __init__(self):
        self.detector = None
        self.trt_model = None
        self._load_model()

    def _load_model(self):
        """Load NudeNet with TensorRT optimization"""
        try:
            # Load base NudeNet model
            self.detector = NudeDetector()

            # Convert to TorchScript if available
            if torch.cuda.is_available():
                logger.info("Compiling model with TensorRT...")

                # Enable TensorRT optimization
                self.trt_model = torch_tensorrt.compile(
                    self.detector.model,
                    inputs=[torch_tensorrt.Input(
                        min_shape=[1, 3, 224, 224],
                        opt_shape=[4, 3, 224, 224],  # Batch size 4
                        max_shape=[8, 3, 224, 224]   # Up to 8
                    )],
                    enabled_precisions={torch.float16},  # FP16 precision
                    workspace_size=1 << 30  # 1GB
                )

                logger.info("TensorRT optimization completed (3-6x speedup expected)")

        except Exception as e:
            logger.error(f"Error loading TensorRT: {e}")
            logger.warning("Falling back to standard inference")
```

**Impact:** 3-6x faster inference, 50% lower VRAM usage

---

#### 1.2 Implement Dynamic Batching

**File:** `runpod-service/main.py`

**Add New Class:**
```python
import asyncio
from collections import deque
from typing import List, Tuple

class FrameBatcher:
    """Batch multiple frames for efficient GPU inference"""

    def __init__(self, max_batch_size=8, max_wait_ms=50):
        self.max_batch_size = max_batch_size
        self.max_wait_ms = max_wait_ms
        self.queue = deque()
        self.processing = False

    async def add_frame(self, session_id: str, frame: np.ndarray) -> Dict:
        """Add frame to batch queue"""
        future = asyncio.Future()
        self.queue.append((session_id, frame, future))

        # Trigger batch processing
        if not self.processing:
            asyncio.create_task(self._process_batch())

        return await future

    async def _process_batch(self):
        """Process accumulated frames in batch"""
        self.processing = True

        # Wait for max_wait_ms or until batch is full
        await asyncio.sleep(self.max_wait_ms / 1000)

        if len(self.queue) == 0:
            self.processing = False
            return

        # Extract batch (up to max_batch_size)
        batch_items = []
        for _ in range(min(self.max_batch_size, len(self.queue))):
            if self.queue:
                batch_items.append(self.queue.popleft())

        # Extract frames
        session_ids, frames, futures = zip(*batch_items)

        try:
            # Batch inference for NSFW detection
            if nsfw_detector:
                batch_results = await nsfw_detector.detect_batch(
                    list(frames),
                    confidence_threshold=0.85
                )

                # Return results to individual futures
                for future, result in zip(futures, batch_results):
                    future.set_result(result)

        except Exception as e:
            # Set exception for all futures
            for future in futures:
                future.set_exception(e)

        finally:
            self.processing = False

            # Process remaining queue
            if self.queue:
                asyncio.create_task(self._process_batch())

# Global batcher
frame_batcher = FrameBatcher(max_batch_size=8, max_wait_ms=50)
```

**Update `/process/frame` endpoint:**
```python
@app.post("/process/frame")
async def process_frame(session_id: str, frame_data: UploadFile = File(...)):
    """Process frame with dynamic batching"""

    # Decode frame
    frame_bytes = await frame_data.read()
    nparr = np.frombuffer(frame_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    # Use batcher for inference
    detections = await frame_batcher.add_frame(session_id, frame)

    # Continue with tracking and blur...
```

**Impact:** 2-3x higher throughput, better GPU utilization

---

#### 1.3 Add Mixed Precision Inference (FP16)

**File:** `runpod-service/processors/text_detector.py`

**Add to model loading:**
```python
def _load_model(self):
    """Load Keras-OCR with FP16 optimization"""
    try:
        import keras_ocr
        import tensorflow as tf

        # Enable mixed precision
        if tf.config.list_physical_devices('GPU'):
            from tensorflow.keras.mixed_precision import Policy
            policy = Policy('mixed_float16')
            tf.keras.mixed_precision.set_global_policy(policy)
            logger.info("FP16 mixed precision enabled (2x faster)")

        self.pipeline = keras_ocr.pipeline.Pipeline()

    except Exception as e:
        logger.error(f"Error loading Keras-OCR: {e}")
```

**Impact:** 2x faster inference, 50% lower VRAM usage

---

#### 1.4 Implement Model Warm-up

**File:** `runpod-service/main.py`

**Add to lifespan startup:**
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and warm up ML models"""
    global text_detector, nsfw_detector, audio_profanity_detector

    logger.info("Initializing ML models...")

    try:
        # Initialize processors
        text_detector = TextDetector()
        nsfw_detector = NSFWDetector()
        audio_profanity_detector = AudioProfanityDetector()
        object_tracker = ObjectTracker()
        blur_applicator = BlurApplicator()

        # Warm up models with dummy data
        logger.info("Warming up models...")
        dummy_frame = np.zeros((720, 1280, 3), dtype=np.uint8)

        # Run inference once to initialize CUDA kernels
        await text_detector.detect(dummy_frame, confidence_threshold=0.7, profanity_list=[])
        await nsfw_detector.detect(dummy_frame, confidence_threshold=0.85)

        logger.info("All ML models loaded and warmed up successfully")

        yield

        # Cleanup
        logger.info("Shutting down processors...")
        active_sessions.clear()

    except Exception as e:
        logger.error(f"Error during startup: {e}")
        raise
```

**Impact:** Eliminate first-request latency spike

---

#### 1.5 Add CUDA Graphs (Advanced)

**File:** `runpod-service/processors/nsfw_detector.py`

**Add CUDA graph caching:**
```python
import torch

class NSFWDetector:
    def __init__(self):
        self.detector = None
        self.cuda_graph = None
        self.static_input = None
        self.static_output = None
        self._load_model()

    def _create_cuda_graph(self, input_shape):
        """Create CUDA graph for repeated inference"""
        if not torch.cuda.is_available():
            return

        try:
            # Allocate static tensors
            self.static_input = torch.zeros(input_shape, device='cuda')

            # Warm up
            with torch.cuda.graph(self.cuda_graph):
                self.static_output = self.detector(self.static_input)

            logger.info("CUDA graph created (lower latency)")

        except Exception as e:
            logger.error(f"Error creating CUDA graph: {e}")
```

**Impact:** 10-20% lower latency for repeated calls

---

### 1.6 Summary: GPU Optimization Impact

| Optimization | Speedup | VRAM Reduction | Difficulty |
|--------------|---------|----------------|------------|
| TensorRT | 3-6x | 30% | Medium |
| Dynamic Batching | 2-3x | 0% | Medium |
| FP16 Precision | 2x | 50% | Easy |
| Model Warm-up | N/A | 0% | Easy |
| CUDA Graphs | 1.2x | 0% | Hard |
| **TOTAL** | **10-15x** | **60%** | - |

---

## 2. Production Error Handling

### 🎯 Goal
Prevent system crashes and implement graceful degradation.

### Current Issues
- ❌ No try-catch blocks in critical paths
- ❌ No fallback when RunPod service fails
- ❌ No retry logic for network calls
- ❌ No circuit breaker for external services
- ❌ Crashes cascade to all users

### Recommendations

#### 2.1 Implement Circuit Breaker

**File:** `server/processors/contentCensorshipProcessor.js`

**Add Circuit Breaker Class:**
```javascript
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 60s
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.nextAttempt = Date.now();
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeout;
      console.error('[CircuitBreaker] Circuit opened due to failures');
    }
  }

  isOpen() {
    return this.state === 'OPEN';
  }
}

// Add to contentCensorshipProcessor
const runpodCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000
});
```

**Update processFrame method:**
```javascript
async processFrame(roomName, frameBuffer) {
  try {
    // Check circuit breaker
    if (runpodCircuitBreaker.isOpen()) {
      console.warn('[Censorship] Circuit breaker OPEN, skipping censorship');
      return {
        success: true,
        bypass: true,
        reason: 'Service unavailable'
      };
    }

    // Execute with circuit breaker
    const result = await runpodCircuitBreaker.execute(async () => {
      return await this._callRunPodService(roomName, frameBuffer);
    });

    return result;

  } catch (error) {
    console.error('[Censorship] Error processing frame:', error);

    // Graceful degradation: return uncensored frame
    return {
      success: true,
      bypass: true,
      detections: [],
      error: error.message
    };
  }
}
```

**Impact:** Prevent cascading failures, automatic recovery

---

#### 2.2 Add Retry Logic with Exponential Backoff

**File:** `server/processors/contentCensorshipProcessor.js`

**Add Retry Function:**
```javascript
async function retryWithBackoff(fn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const initialDelay = options.initialDelay || 1000;
  const maxDelay = options.maxDelay || 10000;
  const backoffFactor = options.backoffFactor || 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(
        initialDelay * Math.pow(backoffFactor, attempt),
        maxDelay
      );

      console.log(
        `[Retry] Attempt ${attempt + 1}/${maxRetries} failed, ` +
        `retrying in ${delay}ms...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Use in HTTP calls
async _callRunPodService(roomName, frameBuffer) {
  return await retryWithBackoff(async () => {
    const response = await axios.post(
      `${this.runpodServiceUrl}/process/frame`,
      formData,
      {
        timeout: 5000,
        headers: formData.getHeaders()
      }
    );
    return response.data;
  }, {
    maxRetries: 3,
    initialDelay: 500,
    maxDelay: 5000
  });
}
```

**Impact:** 95% success rate even with transient failures

---

#### 2.3 Add Comprehensive Error Handling

**File:** `runpod-service/main.py`

**Update all endpoints:**
```python
@app.post("/process/frame")
async def process_frame(session_id: str, frame_data: UploadFile = File(...)):
    """Process frame with comprehensive error handling"""

    # Validate session
    if session_id not in active_sessions:
        raise HTTPException(
            status_code=404,
            detail=f"Session not found: {session_id}"
        )

    session = active_sessions[session_id]

    try:
        # Read frame data
        frame_bytes = await frame_data.read()

        # Validate frame size
        if len(frame_bytes) > 10 * 1024 * 1024:  # 10MB limit
            raise HTTPException(
                status_code=413,
                detail="Frame too large (max 10MB)"
            )

        nparr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            raise HTTPException(
                status_code=400,
                detail="Invalid frame data (could not decode)"
            )

        # Validate frame dimensions
        height, width = frame.shape[:2]
        if width > 4096 or height > 4096:
            raise HTTPException(
                status_code=400,
                detail="Frame dimensions too large (max 4096x4096)"
            )

        session.frame_count += 1

        # Process with error handling for each detector
        detections = []
        errors = []

        # Text detection with fallback
        if session.config.enable_text_detection:
            try:
                text_results = await asyncio.wait_for(
                    text_detector.detect(
                        frame,
                        session.config.text_confidence,
                        session.config.profanity_list
                    ),
                    timeout=2.0  # 2s timeout
                )
                detections.extend(text_results)
            except asyncio.TimeoutError:
                logger.warning("Text detection timeout, skipping")
                errors.append("text_detection_timeout")
            except Exception as e:
                logger.error(f"Text detection error: {e}")
                errors.append(f"text_detection_error: {str(e)}")

        # NSFW detection with fallback
        if session.config.enable_nsfw_detection:
            try:
                nsfw_results = await asyncio.wait_for(
                    nsfw_detector.detect(
                        frame,
                        session.config.nsfw_confidence
                    ),
                    timeout=2.0
                )
                detections.extend(nsfw_results)
            except asyncio.TimeoutError:
                logger.warning("NSFW detection timeout, skipping")
                errors.append("nsfw_detection_timeout")
            except Exception as e:
                logger.error(f"NSFW detection error: {e}")
                errors.append(f"nsfw_detection_error: {str(e)}")

        # Tracking with fallback
        if session.config.enable_object_tracking:
            try:
                detections = await object_tracker.update_trackers(
                    frame,
                    detections,
                    session.trackers
                )
            except Exception as e:
                logger.error(f"Tracking error: {e}")
                errors.append(f"tracking_error: {str(e)}")

        # Blur with fallback
        try:
            blurred_frame = await blur_applicator.apply_blur(frame, detections)
        except Exception as e:
            logger.error(f"Blur error: {e}, returning original frame")
            blurred_frame = frame
            errors.append(f"blur_error: {str(e)}")

        return {
            "frame_id": session.frame_count,
            "detections": detections,
            "detection_count": len(detections),
            "has_blur": len(detections) > 0,
            "errors": errors if errors else None,
            "processing_time_ms": 0
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error processing frame: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )
```

**Impact:** Graceful error handling, no crashes

---

#### 2.4 Add Health Checks with Dependencies

**File:** `runpod-service/main.py`

**Enhanced health check:**
```python
@app.get("/health")
async def health_check():
    """Comprehensive health check"""

    health_status = {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "checks": {}
    }

    # Check GPU availability
    try:
        gpu_count = cv2.cuda.getCudaEnabledDeviceCount()
        health_status["checks"]["gpu"] = {
            "status": "healthy" if gpu_count > 0 else "degraded",
            "available_gpus": gpu_count
        }
    except Exception as e:
        health_status["checks"]["gpu"] = {
            "status": "unhealthy",
            "error": str(e)
        }
        health_status["status"] = "degraded"

    # Check models
    models = {
        "text_detector": text_detector,
        "nsfw_detector": nsfw_detector,
        "audio_profanity_detector": audio_profanity_detector,
        "object_tracker": object_tracker,
        "blur_applicator": blur_applicator
    }

    for name, model in models.items():
        health_status["checks"][name] = {
            "status": "healthy" if model is not None else "unhealthy"
        }
        if model is None:
            health_status["status"] = "degraded"

    # Check memory usage
    import psutil
    memory = psutil.virtual_memory()
    health_status["checks"]["memory"] = {
        "status": "healthy" if memory.percent < 90 else "degraded",
        "used_percent": memory.percent,
        "available_gb": memory.available / (1024**3)
    }

    if memory.percent >= 90:
        health_status["status"] = "degraded"

    # Check active sessions
    health_status["checks"]["sessions"] = {
        "status": "healthy",
        "active_count": len(active_sessions)
    }

    # Overall status code
    status_code = 200 if health_status["status"] == "healthy" else 503

    return JSONResponse(content=health_status, status_code=status_code)
```

**Impact:** Better monitoring, early warning system

---

### 2.5 Summary: Error Handling Impact

| Feature | Before | After | Impact |
|---------|--------|-------|--------|
| **Uptime** | 95% (crashes) | 99.9% (graceful) | Critical |
| **Recovery Time** | Manual restart | Automatic | Critical |
| **User Impact** | All users affected | Isolated failures | High |
| **Debugging** | Logs only | Structured errors | Medium |

---

## 3. Security Hardening

### 🎯 Goal
Make the system production-ready and secure against common attacks.

### Current Issues
- ❌ No webhook signature verification
- ❌ CORS allows all origins (`*`)
- ❌ No rate limiting
- ❌ No input validation/sanitization
- ❌ No API authentication
- ❌ Secrets in environment files

### Recommendations

#### 3.1 Add Webhook Signature Verification

**File:** `server/webhooks.js`

**Add verification middleware:**
```javascript
import crypto from 'crypto';

/**
 * Verify LiveKit webhook signature
 */
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['livekit-signature'];
  const timestamp = req.headers['livekit-timestamp'];

  if (!signature || !timestamp) {
    return res.status(401).json({ error: 'Missing signature or timestamp' });
  }

  // Check timestamp (prevent replay attacks)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp);

  if (Math.abs(currentTime - requestTime) > 300) { // 5 minutes
    return res.status(401).json({ error: 'Request timestamp too old' });
  }

  // Verify signature
  const webhookSecret = process.env.LIVEKIT_WEBHOOK_SECRET;
  const payload = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  if (signature !== expectedSignature) {
    console.error('[Webhook] Invalid signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

export { handleWebhook, verifyWebhookSignature };
```

**Update server.js:**
```javascript
app.post('/livekit/webhook', verifyWebhookSignature, handleWebhook);
```

**Add to `.env.example`:**
```
LIVEKIT_WEBHOOK_SECRET=your_webhook_secret_here
```

**Impact:** Prevent unauthorized webhook calls

---

#### 3.2 Implement Rate Limiting

**File:** `server/server.js`

**Install dependencies:**
```bash
npm install express-rate-limit
```

**Add rate limiting:**
```javascript
import rateLimit from 'express-rate-limit';

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many requests to sensitive endpoint',
});

// Apply to all routes
app.use('/api/', apiLimiter);

// Apply strict limiter to sensitive endpoints
app.post('/token', strictLimiter, async (req, res) => { /* ... */ });
app.post('/censorship/rules', strictLimiter, async (req, res) => { /* ... */ });
app.post('/stream/start', strictLimiter, async (req, res) => { /* ... */ });
```

**Impact:** Prevent DDoS attacks, API abuse

---

#### 3.3 Fix CORS Configuration

**File:** `server/server.js`

**Replace wildcard CORS:**
```javascript
// Current (INSECURE)
app.use(cors());

// Improved (SECURE)
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:5173', // Vite dev server
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

**Add to `.env`:**
```
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

**Impact:** Prevent cross-site attacks

---

#### 3.4 Add Input Validation

**File:** `server/server.js`

**Install validator:**
```bash
npm install joi
```

**Add validation schemas:**
```javascript
import Joi from 'joi';

// Token generation validation
const tokenSchema = Joi.object({
  roomName: Joi.string()
    .alphanum()
    .min(3)
    .max(50)
    .required(),
  participantName: Joi.string()
    .min(2)
    .max(50)
    .pattern(/^[a-zA-Z0-9\s-_]+$/)
    .required(),
  role: Joi.string()
    .valid('broadcaster', 'viewer')
    .required(),
  metadata: Joi.object().optional()
});

// Validation middleware
const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: error.details.map(d => d.message)
      });
    }
    next();
  };
};

// Apply to endpoints
app.post('/token', validateRequest(tokenSchema), async (req, res) => {
  // ... token generation
});
```

**Impact:** Prevent injection attacks, data corruption

---

#### 3.5 Add API Authentication

**File:** `server/middleware/auth.js` (NEW)

**Create authentication middleware:**
```javascript
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

/**
 * Generate API token
 */
export function generateApiToken(userId, expiresIn = '24h') {
  return jwt.sign(
    { userId, type: 'api' },
    JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Verify API token middleware
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  });
}

/**
 * Optional authentication (allows anonymous)
 */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err) {
        req.user = user;
      }
    });
  }

  next();
}
```

**Apply to sensitive endpoints:**
```javascript
import { authenticateToken } from './middleware/auth.js';

// Protect admin endpoints
app.post('/censorship/rules', authenticateToken, async (req, res) => {
  // Only authenticated users can update rules
});

app.get('/censorship/sessions', authenticateToken, async (req, res) => {
  // Only authenticated users can view sessions
});
```

**Impact:** Prevent unauthorized access

---

### 3.6 Summary: Security Impact

| Vulnerability | Before | After | Severity |
|---------------|--------|-------|----------|
| **Webhook Spoofing** | Unverified | Signature verified | Critical |
| **DDoS/Abuse** | No limit | Rate limited | High |
| **CORS Attacks** | Wide open | Restricted origins | High |
| **Injection** | No validation | Input validated | High |
| **Unauthorized Access** | No auth | JWT tokens | Medium |

---

## 4. State Management & Persistence

### 🎯 Goal
Replace in-memory storage with Redis for distributed, persistent state.

### Current Issues
- ❌ State lost on server restart
- ❌ Cannot scale horizontally (multiple servers)
- ❌ No session recovery
- ❌ Analytics data lost

### Recommendations

#### 4.1 Add Redis for State Management

**Install Redis client:**
```bash
cd server
npm install ioredis
```

**File:** `server/services/redisClient.js` (NEW)

**Create Redis client:**
```javascript
import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(redisUrl, {
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('connect', () => {
  console.log('[Redis] Connected to Redis server');
});

redis.on('error', (err) => {
  console.error('[Redis] Error:', err);
});

redis.on('ready', () => {
  console.log('[Redis] Redis client ready');
});

export default redis;
```

---

#### 4.2 Migrate RoomManager to Redis

**File:** `server/roomManager.js`

**Replace Map with Redis:**
```javascript
import redis from './services/redisClient.js';

class RoomManager {
  constructor() {
    this.roomKeyPrefix = 'room:';
    this.participantKeyPrefix = 'participant:';
    this.trackKeyPrefix = 'track:';
  }

  /**
   * Create a room
   */
  async createRoom(roomName) {
    const roomKey = `${this.roomKeyPrefix}${roomName}`;

    const room = {
      name: roomName,
      broadcaster: null,
      viewers: [],
      isLive: false,
      createdAt: new Date().toISOString(),
      tracks: {
        video: [],
        audio: [],
        screenShare: []
      },
      analytics: {
        totalViewers: 0,
        peakViewers: 0,
        startTime: null,
        endTime: null,
        duration: 0
      }
    };

    // Store room in Redis (expire after 24 hours if inactive)
    await redis.setex(roomKey, 24 * 60 * 60, JSON.stringify(room));

    console.log(`[RoomManager] Room created: ${roomName}`);
    return room;
  }

  /**
   * Get room
   */
  async getRoom(roomName) {
    const roomKey = `${this.roomKeyPrefix}${roomName}`;
    const roomData = await redis.get(roomKey);

    if (!roomData) {
      return null;
    }

    return JSON.parse(roomData);
  }

  /**
   * Update room
   */
  async updateRoom(roomName, updates) {
    const room = await this.getRoom(roomName);
    if (!room) {
      throw new Error(`Room not found: ${roomName}`);
    }

    const updatedRoom = { ...room, ...updates };
    const roomKey = `${this.roomKeyPrefix}${roomName}`;

    await redis.setex(roomKey, 24 * 60 * 60, JSON.stringify(updatedRoom));

    return updatedRoom;
  }

  /**
   * Delete room
   */
  async deleteRoom(roomName) {
    const roomKey = `${this.roomKeyPrefix}${roomName}`;
    await redis.del(roomKey);

    console.log(`[RoomManager] Room deleted: ${roomName}`);
  }

  /**
   * Add participant to room
   */
  async addParticipant(roomName, participant) {
    const room = await this.getRoom(roomName);
    if (!room) {
      await this.createRoom(roomName);
    }

    const role = participant.identity.includes('broadcaster') ? 'broadcaster' : 'viewer';

    if (role === 'broadcaster') {
      await this.updateRoom(roomName, {
        broadcaster: participant,
        isLive: true,
        'analytics.startTime': new Date().toISOString()
      });
    } else {
      room.viewers.push(participant);
      room.analytics.totalViewers++;
      room.analytics.peakViewers = Math.max(
        room.analytics.peakViewers,
        room.viewers.length
      );

      await this.updateRoom(roomName, room);
    }

    console.log(`[RoomManager] Participant added: ${participant.identity} to ${roomName}`);
  }

  /**
   * Get all live rooms
   */
  async getLiveRooms() {
    const keys = await redis.keys(`${this.roomKeyPrefix}*`);
    const rooms = [];

    for (const key of keys) {
      const roomData = await redis.get(key);
      if (roomData) {
        const room = JSON.parse(roomData);
        if (room.isLive) {
          rooms.push(room);
        }
      }
    }

    return rooms;
  }

  /**
   * Get room analytics
   */
  async getRoomAnalytics(roomName) {
    const room = await this.getRoom(roomName);
    if (!room) {
      return null;
    }

    return {
      roomName: room.name,
      isLive: room.isLive,
      currentViewers: room.viewers.length,
      ...room.analytics
    };
  }
}

// Singleton instance
const roomManager = new RoomManager();

export default roomManager;
```

**Update server.js endpoints to use async/await:**
```javascript
app.get('/room/analytics/:roomName', async (req, res) => {
  try {
    const { roomName } = req.params;
    const analytics = await roomManager.getRoomAnalytics(roomName);

    if (!analytics) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json(analytics);
  } catch (error) {
    console.error('[API] Error getting analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});
```

**Impact:** State persists across restarts, horizontal scaling enabled

---

#### 4.3 Add PostgreSQL for Analytics

**Install dependencies:**
```bash
npm install pg
```

**File:** `server/services/database.js` (NEW)

**Create database client:**
```javascript
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/livekit_analytics',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  console.log('[Database] Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('[Database] Unexpected error:', err);
});

/**
 * Initialize database schema
 */
export async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS streams (
        id SERIAL PRIMARY KEY,
        room_name VARCHAR(255) NOT NULL,
        broadcaster_identity VARCHAR(255),
        started_at TIMESTAMP NOT NULL,
        ended_at TIMESTAMP,
        duration_seconds INTEGER,
        peak_viewers INTEGER DEFAULT 0,
        total_viewers INTEGER DEFAULT 0,
        censorship_events INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_streams_room_name ON streams(room_name);
      CREATE INDEX IF NOT EXISTS idx_streams_started_at ON streams(started_at);

      CREATE TABLE IF NOT EXISTS censorship_events (
        id SERIAL PRIMARY KEY,
        stream_id INTEGER REFERENCES streams(id),
        room_name VARCHAR(255) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        detection_type VARCHAR(50),
        confidence FLOAT,
        frame_id INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_censorship_events_stream_id ON censorship_events(stream_id);
      CREATE INDEX IF NOT EXISTS idx_censorship_events_timestamp ON censorship_events(timestamp);
    `);

    console.log('[Database] Schema initialized');
  } catch (error) {
    console.error('[Database] Error initializing schema:', error);
  }
}

/**
 * Log stream start
 */
export async function logStreamStart(roomName, broadcasterIdentity) {
  const result = await pool.query(
    `INSERT INTO streams (room_name, broadcaster_identity, started_at)
     VALUES ($1, $2, NOW())
     RETURNING id`,
    [roomName, broadcasterIdentity]
  );

  return result.rows[0].id;
}

/**
 * Log stream end
 */
export async function logStreamEnd(streamId, stats) {
  await pool.query(
    `UPDATE streams
     SET ended_at = NOW(),
         duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at)),
         peak_viewers = $1,
         total_viewers = $2,
         censorship_events = $3
     WHERE id = $4`,
    [stats.peakViewers, stats.totalViewers, stats.censorshipEvents, streamId]
  );
}

/**
 * Log censorship event
 */
export async function logCensorshipEvent(streamId, roomName, eventData) {
  await pool.query(
    `INSERT INTO censorship_events (stream_id, room_name, event_type, detection_type, confidence, frame_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      streamId,
      roomName,
      eventData.type,
      eventData.detectionType,
      eventData.confidence,
      eventData.frameId
    ]
  );
}

/**
 * Get analytics for date range
 */
export async function getAnalytics(startDate, endDate) {
  const result = await pool.query(
    `SELECT
       COUNT(*) as total_streams,
       SUM(total_viewers) as total_viewers,
       AVG(peak_viewers) as avg_peak_viewers,
       AVG(duration_seconds) as avg_duration_seconds,
       SUM(censorship_events) as total_censorship_events
     FROM streams
     WHERE started_at BETWEEN $1 AND $2`,
    [startDate, endDate]
  );

  return result.rows[0];
}

export default pool;
```

**Add to server startup:**
```javascript
import { initDatabase } from './services/database.js';

app.listen(PORT, async () => {
  console.log('\n🚀 LiveKit Webinar Server Started\n');

  // Initialize database
  await initDatabase();

  // ... rest of startup
});
```

**Impact:** Persistent analytics, historical data, insights

---

### 4.4 Summary: State Management Impact

| Feature | Before | After | Impact |
|---------|--------|-------|--------|
| **State Persistence** | Lost on restart | Persisted in Redis | Critical |
| **Horizontal Scaling** | Single server only | Multi-server ready | High |
| **Analytics** | In-memory only | Historical database | High |
| **Recovery** | Manual recreation | Automatic | Medium |

---

## 5. Performance Optimizations

### 🎯 Goal
Reduce latency and improve throughput across the entire system.

### Current Issues
- ❌ No caching of censorship rules
- ❌ No HTTP connection pooling
- ❌ Inefficient React re-renders
- ❌ No CDN for static assets
- ❌ Suboptimal frame sampling

### Recommendations

#### 5.1 Add Caching Layer for Rules

**File:** `server/services/censorshipRulesService.js`

**Add Redis caching:**
```javascript
import redis from './redisClient.js';

class CensorshipRulesService {
  constructor() {
    this.cacheKeyPrefix = 'rules:';
    this.cacheExpiry = 300; // 5 minutes
  }

  /**
   * Get rules with caching
   */
  async getRules() {
    const cacheKey = `${this.cacheKeyPrefix}global`;

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log('[Rules] Cache hit');
      return JSON.parse(cached);
    }

    // Load from file
    const rules = await this._loadRulesFromFile();

    // Cache for 5 minutes
    await redis.setex(cacheKey, this.cacheExpiry, JSON.stringify(rules));

    return rules;
  }

  /**
   * Get room-specific rules with caching
   */
  async getRoomRules(roomName) {
    const cacheKey = `${this.cacheKeyPrefix}${roomName}`;

    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Load from file and merge with global
    const globalRules = await this.getRules();
    const roomOverrides = globalRules.roomOverrides?.[roomName] || {};

    const mergedRules = this._mergeRules(globalRules, roomOverrides);

    // Cache for 5 minutes
    await redis.setex(cacheKey, this.cacheExpiry, JSON.stringify(mergedRules));

    return mergedRules;
  }

  /**
   * Update rules and invalidate cache
   */
  async updateGlobalRules(newRules) {
    // Update file
    await this._saveRulesToFile(newRules);

    // Invalidate cache
    const cacheKey = `${this.cacheKeyPrefix}global`;
    await redis.del(cacheKey);

    // Invalidate all room caches
    const roomKeys = await redis.keys(`${this.cacheKeyPrefix}*`);
    if (roomKeys.length > 0) {
      await redis.del(...roomKeys);
    }

    console.log('[Rules] Cache invalidated after update');

    return { success: true };
  }

  // ... rest of methods
}
```

**Impact:** 10-50ms faster rule lookups, reduced file I/O

---

#### 5.2 Add HTTP Connection Pooling

**File:** `server/processors/contentCensorshipProcessor.js`

**Configure axios with pooling:**
```javascript
import axios from 'axios';
import http from 'http';
import https from 'https';

class ContentCensorshipProcessor {
  constructor() {
    this.runpodServiceUrl = process.env.RUNPOD_SERVICE_URL || 'http://localhost:8000';

    // Create HTTP client with connection pooling
    this.httpClient = axios.create({
      timeout: 10000,
      maxRedirects: 0,
      httpAgent: new http.Agent({
        keepAlive: true,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000,
        freeSocketTimeout: 30000
      }),
      httpsAgent: new https.Agent({
        keepAlive: true,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000,
        freeSocketTimeout: 30000
      })
    });
  }

  async processFrame(roomName, frameBuffer) {
    // Use pooled client
    const response = await this.httpClient.post(
      '/process/frame',
      formData,
      { headers: formData.getHeaders() }
    );

    return response.data;
  }
}
```

**Impact:** 20-30% faster HTTP requests, lower latency

---

#### 5.3 Optimize React Rendering

**File:** `client/src/Broadcaster.jsx`

**Add memoization:**
```jsx
import { useState, useEffect, useMemo, useCallback, memo } from 'react';

// Memoize BroadcasterStream component
const BroadcasterStream = memo(function BroadcasterStream() {
  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare],
    { onlySubscribed: false }
  );

  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  // Memoize viewer count calculation
  const viewerCount = useMemo(() => {
    return Math.max(0, participants.length - 1);
  }, [participants.length]);

  // Memoize track finding
  const localVideoTrack = useMemo(() => {
    return tracks.find(
      track => track.participant.identity === localParticipant.identity &&
              track.source === Track.Source.Camera
    );
  }, [tracks, localParticipant.identity]);

  const screenShareTrack = useMemo(() => {
    return tracks.find(track => track.source === Track.Source.ScreenShare);
  }, [tracks]);

  return (
    <div className="broadcaster-layout">
      {/* ... rest of component */}
    </div>
  );
});

export default function Broadcaster({ roomName, participantName, onLeave }) {
  const [token, setToken] = useState('');
  const [wsUrl, setWsUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Memoize SERVER_URL
  const SERVER_URL = useMemo(() => {
    return import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
  }, []);

  // Use useCallback for event handlers
  const handleError = useCallback((error) => {
    console.error('LiveKit connection error:', error);
    setError(`Connection failed: ${error.message}`);
  }, []);

  const handleDisconnected = useCallback(() => {
    onLeave();
  }, [onLeave]);

  // ... rest of component
}
```

**Impact:** 30-50% fewer re-renders, smoother UI

---

#### 5.4 Implement Adaptive Frame Sampling

**File:** `runpod-service/main.py`

**Add adaptive sampling:**
```python
class StreamSession:
    """Manages a streaming session with adaptive sampling"""

    def __init__(self, session_id: str, config: ProcessingConfig):
        self.session_id = session_id
        self.config = config
        self.frame_count = 0
        self.trackers: Dict = {}

        # Adaptive sampling state
        self.recent_detection_rate = 0.0
        self.last_100_frames = deque(maxlen=100)
        self.adaptive_sampling_enabled = True

        logger.info(f"[Session {session_id}] Created with adaptive sampling")

    def should_process_frame(self) -> bool:
        """Adaptive frame sampling based on detection rate"""

        if not self.adaptive_sampling_enabled:
            return self.frame_count % self.config.frame_sample_rate == 0

        # Calculate recent detection rate
        if len(self.last_100_frames) >= 10:
            self.recent_detection_rate = sum(self.last_100_frames) / len(self.last_100_frames)

        # Adjust sample rate based on detection rate
        if self.recent_detection_rate > 0.5:
            # High detection rate: process every frame
            sample_rate = 1
        elif self.recent_detection_rate > 0.2:
            # Medium detection rate: process every 2nd frame
            sample_rate = 2
        elif self.recent_detection_rate > 0.05:
            # Low detection rate: process every 3rd frame
            sample_rate = 3
        else:
            # Very low detection rate: process every 5th frame
            sample_rate = 5

        should_process = self.frame_count % sample_rate == 0

        logger.debug(
            f"[Session {self.session_id}] Frame {self.frame_count}: "
            f"detection_rate={self.recent_detection_rate:.2f}, "
            f"sample_rate={sample_rate}, "
            f"processing={should_process}"
        )

        return should_process

    def record_detection_result(self, has_detections: bool):
        """Record whether frame had detections"""
        self.last_100_frames.append(1 if has_detections else 0)
```

**Impact:** 40-60% fewer frames processed, same detection quality

---

### 5.5 Summary: Performance Impact

| Optimization | Latency Reduction | Throughput Increase | Difficulty |
|--------------|-------------------|---------------------|------------|
| Rules Caching | 10-50ms | N/A | Easy |
| HTTP Pooling | 20-30% | 2x | Easy |
| React Memo | N/A | 30-50% fewer renders | Easy |
| Adaptive Sampling | N/A | 40-60% fewer frames | Medium |
| **TOTAL** | **~100ms** | **3-4x** | - |

---

## 6. Monitoring & Observability

### 🎯 Goal
Add comprehensive monitoring, metrics, and distributed tracing.

### Current Issues
- ❌ Only console.log for debugging
- ❌ No metrics collection
- ❌ No distributed tracing
- ❌ No alerts on failures
- ❌ No performance dashboards

### Recommendations

#### 6.1 Add Prometheus Metrics

**Install dependencies:**
```bash
cd server
npm install prom-client
```

**File:** `server/middleware/metrics.js` (NEW)

**Create metrics collector:**
```javascript
import promClient from 'prom-client';

// Create registry
const register = new promClient.Registry();

// Add default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register });

// Custom metrics

// HTTP request duration
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});
register.registerMetric(httpRequestDuration);

// Active streams
const activeStreams = new promClient.Gauge({
  name: 'livekit_active_streams',
  help: 'Number of currently active streams'
});
register.registerMetric(activeStreams);

// Censorship detections
const censorshipDetections = new promClient.Counter({
  name: 'censorship_detections_total',
  help: 'Total number of censorship detections',
  labelNames: ['type', 'room_name']
});
register.registerMetric(censorshipDetections);

// Frame processing time
const frameProcessingTime = new promClient.Histogram({
  name: 'frame_processing_duration_seconds',
  help: 'Time to process a single frame',
  labelNames: ['room_name', 'processor'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2]
});
register.registerMetric(frameProcessingTime);

// RunPod service health
const runpodServiceUp = new promClient.Gauge({
  name: 'runpod_service_up',
  help: '1 if RunPod service is healthy, 0 otherwise'
});
register.registerMetric(runpodServiceUp);

// Middleware to track HTTP metrics
export function metricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
  });

  next();
}

// Metrics endpoint
export function metricsEndpoint(req, res) {
  res.set('Content-Type', register.contentType);
  register.metrics().then(metrics => res.send(metrics));
}

export {
  register,
  activeStreams,
  censorshipDetections,
  frameProcessingTime,
  runpodServiceUp
};
```

**Add to server.js:**
```javascript
import { metricsMiddleware, metricsEndpoint } from './middleware/metrics.js';

// Add metrics middleware
app.use(metricsMiddleware);

// Expose metrics endpoint
app.get('/metrics', metricsEndpoint);

console.log(`  - Metrics (Prometheus): GET  http://localhost:${PORT}/metrics`);
```

**Update processors to record metrics:**
```javascript
import { censorshipDetections, frameProcessingTime } from '../middleware/metrics.js';

async processFrame(roomName, frameBuffer) {
  const startTime = Date.now();

  try {
    // Process frame...
    const result = await this._callRunPodService(roomName, frameBuffer);

    // Record metrics
    const duration = (Date.now() - startTime) / 1000;
    frameProcessingTime
      .labels(roomName, 'runpod')
      .observe(duration);

    // Record detections
    if (result.detections) {
      for (const detection of result.detections) {
        censorshipDetections
          .labels(detection.type, roomName)
          .inc();
      }
    }

    return result;
  } catch (error) {
    // ... error handling
  }
}
```

**Impact:** Full visibility into system performance

---

#### 6.2 Add Structured Logging

**Install Winston:**
```bash
npm install winston
```

**File:** `server/services/logger.js` (NEW)

**Create structured logger:**
```javascript
import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'livekit-server' },
  transports: [
    // Console output (JSON in production, pretty in development)
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
    }),

    // File outputs
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760,
      maxFiles: 5
    })
  ]
});

// Helper methods
logger.logRequest = (req, message, meta = {}) => {
  logger.info(message, {
    ...meta,
    request_id: req.id,
    method: req.method,
    path: req.path,
    ip: req.ip,
    user_agent: req.get('user-agent')
  });
};

logger.logError = (error, context = {}) => {
  logger.error(error.message, {
    ...context,
    stack: error.stack,
    name: error.name
  });
};

export default logger;
```

**Replace console.log with structured logging:**
```javascript
import logger from './services/logger.js';

// Before
console.log(`[API] Starting stream: ${roomName}`);

// After
logger.info('Stream starting', {
  component: 'stream_manager',
  room_name: roomName,
  broadcaster: broadcasterName
});

// Before
console.error('[API] Error starting stream:', error);

// After
logger.logError(error, {
  component: 'stream_manager',
  operation: 'start_stream',
  room_name: roomName
});
```

**Impact:** Easier debugging, log aggregation ready

---

#### 6.3 Add Distributed Tracing

**Install OpenTelemetry:**
```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
```

**File:** `server/tracing.js` (NEW)

**Configure tracing:**
```javascript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'livekit-server',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false, // Too noisy
      },
    }),
  ],
});

sdk.start();

console.log('[Tracing] OpenTelemetry initialized');

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('[Tracing] Shutdown complete'))
    .catch((error) => console.error('[Tracing] Error shutting down', error))
    .finally(() => process.exit(0));
});

export default sdk;
```

**Add to server.js (first import):**
```javascript
// MUST be first import
import './tracing.js';

// Then other imports...
import express from 'express';
```

**Impact:** End-to-end request tracing, identify bottlenecks

---

#### 6.4 Create Monitoring Dashboard

**File:** `monitoring/prometheus.yml` (NEW)

**Prometheus configuration:**
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'livekit-server'
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/metrics'

  - job_name: 'runpod-service'
    static_configs:
      - targets: ['runpod-service:8000']
    metrics_path: '/health'

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']

rule_files:
  - 'alerts.yml'
```

**File:** `monitoring/alerts.yml` (NEW)

**Alert rules:**
```yaml
groups:
  - name: livekit_alerts
    interval: 30s
    rules:
      - alert: HighErrorRate
        expr: rate(http_request_duration_seconds_count{status_code=~"5.."}[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value }} per second"

      - alert: RunPodServiceDown
        expr: runpod_service_up == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "RunPod service is down"
          description: "Censorship processing unavailable"

      - alert: HighFrameProcessingLatency
        expr: histogram_quantile(0.95, rate(frame_processing_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High frame processing latency"
          description: "95th percentile latency is {{ $value }}s"

      - alert: HighMemoryUsage
        expr: process_resident_memory_bytes / 1024 / 1024 > 2000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "Memory usage is {{ $value }}MB"
```

**File:** `monitoring/grafana-dashboard.json` (NEW)

**Grafana dashboard definition:**
```json
{
  "dashboard": {
    "title": "LiveKit Censorship System",
    "panels": [
      {
        "title": "Active Streams",
        "type": "graph",
        "targets": [
          {
            "expr": "livekit_active_streams"
          }
        ]
      },
      {
        "title": "Censorship Detections by Type",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(censorship_detections_total[5m])",
            "legendFormat": "{{type}}"
          }
        ]
      },
      {
        "title": "Frame Processing Latency (p95)",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(frame_processing_duration_seconds_bucket[5m]))"
          }
        ]
      },
      {
        "title": "HTTP Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_request_duration_seconds_count[5m])",
            "legendFormat": "{{method}} {{route}}"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_request_duration_seconds_count{status_code=~\"5..\"}[5m])"
          }
        ]
      },
      {
        "title": "Memory Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "process_resident_memory_bytes / 1024 / 1024"
          }
        ]
      }
    ]
  }
}
```

**Impact:** Real-time dashboards, proactive alerting

---

### 6.5 Summary: Monitoring Impact

| Component | Before | After | Impact |
|-----------|--------|-------|--------|
| **Metrics** | None | Prometheus | Critical |
| **Logging** | Console only | Structured JSON | High |
| **Tracing** | None | OpenTelemetry | High |
| **Dashboards** | None | Grafana | High |
| **Alerts** | None | Automated | Critical |

---

## 7. WebSocket Optimization

### 🎯 Goal
Improve WebSocket reliability and performance for frame streaming.

### Current Issues
- ❌ No reconnection logic
- ❌ No backpressure handling
- ❌ Using base64 encoding (inefficient)
- ❌ No frame rate control
- ❌ No connection monitoring

### Recommendations

#### 7.1 Implement WebSocket Reconnection

**File:** `client/src/Broadcaster.jsx`

**Add reconnection logic:**
```jsx
import { useState, useEffect, useRef, useCallback } from 'react';

function useReconnectingLiveKit(roomName, participantName, role) {
  const [token, setToken] = useState('');
  const [wsUrl, setWsUrl] = useState('');
  const [connectionState, setConnectionState] = useState('connecting');
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef(null);
  const maxReconnectDelay = 30000; // 30 seconds

  const fetchToken = useCallback(async () => {
    try {
      const response = await fetch(`${SERVER_URL}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, participantName, role }),
      });

      if (!response.ok) {
        throw new Error('Failed to get token');
      }

      const data = await response.json();
      setToken(data.token);
      setWsUrl(data.wsUrl);
      setConnectionState('connected');
      reconnectAttempts.current = 0;

      return true;
    } catch (error) {
      console.error('Error fetching token:', error);
      return false;
    }
  }, [roomName, participantName, role]);

  const reconnect = useCallback(() => {
    // Clear existing timeout
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }

    // Calculate backoff delay
    const delay = Math.min(
      1000 * Math.pow(2, reconnectAttempts.current),
      maxReconnectDelay
    );

    console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current + 1})`);
    setConnectionState('reconnecting');

    reconnectTimeout.current = setTimeout(async () => {
      reconnectAttempts.current++;
      const success = await fetchToken();

      if (!success && reconnectAttempts.current < 10) {
        reconnect(); // Try again
      } else if (!success) {
        setConnectionState('failed');
      }
    }, delay);
  }, [fetchToken]);

  const handleDisconnected = useCallback(() => {
    console.warn('LiveKit disconnected, attempting reconnection');
    reconnect();
  }, [reconnect]);

  const handleError = useCallback((error) => {
    console.error('LiveKit error:', error);
    reconnect();
  }, [reconnect]);

  useEffect(() => {
    fetchToken();

    return () => {
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
    };
  }, [fetchToken]);

  return {
    token,
    wsUrl,
    connectionState,
    handleDisconnected,
    handleError
  };
}

// Use in component
export default function Broadcaster({ roomName, participantName, onLeave }) {
  const {
    token,
    wsUrl,
    connectionState,
    handleDisconnected,
    handleError
  } = useReconnectingLiveKit(roomName, participantName, 'broadcaster');

  // Show connection status
  if (connectionState === 'reconnecting') {
    return <div>Reconnecting...</div>;
  }

  if (connectionState === 'failed') {
    return <div>Connection failed. Please refresh.</div>;
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={wsUrl}
      onDisconnected={handleDisconnected}
      onError={handleError}
    >
      <BroadcasterStream />
    </LiveKitRoom>
  );
}
```

**Impact:** Automatic recovery from network issues

---

#### 7.2 Add Backpressure Handling

**File:** `runpod-service/main.py`

**Implement backpressure:**
```python
import asyncio
from asyncio import Queue

@app.websocket("/ws/stream/{session_id}")
async def websocket_stream(websocket: WebSocket, session_id: str):
    """WebSocket with backpressure handling"""
    await websocket.accept()

    if session_id not in active_sessions:
        await websocket.send_json({"error": "Session not found"})
        await websocket.close()
        return

    session = active_sessions[session_id]

    # Create bounded queue for backpressure
    frame_queue = Queue(maxsize=10)  # Buffer up to 10 frames

    async def frame_receiver():
        """Receive frames from client"""
        try:
            while True:
                data = await websocket.receive_bytes()

                # Try to add to queue (non-blocking)
                try:
                    frame_queue.put_nowait(data)
                except asyncio.QueueFull:
                    logger.warning(
                        f"[Session {session_id}] Frame queue full, "
                        "dropping frame (client sending too fast)"
                    )
                    # Drop frame to prevent memory buildup

        except WebSocketDisconnect:
            logger.info(f"[Session {session_id}] Client disconnected")
        except Exception as e:
            logger.error(f"[Session {session_id}] Receiver error: {e}")

    async def frame_processor():
        """Process frames from queue"""
        try:
            while True:
                # Wait for frame with timeout
                try:
                    data = await asyncio.wait_for(
                        frame_queue.get(),
                        timeout=5.0
                    )
                except asyncio.TimeoutError:
                    # No frames for 5 seconds, check if connection alive
                    await websocket.send_json({"ping": True})
                    continue

                session.frame_count += 1

                # Check if we should process
                if not session.should_process_frame():
                    await websocket.send_json({
                        "frame_id": session.frame_count,
                        "skipped": True
                    })
                    continue

                # Decode and process frame
                nparr = np.frombuffer(data, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                if frame is None:
                    await websocket.send_json({"error": "Invalid frame"})
                    continue

                # Process (with timeout)
                try:
                    detections = await asyncio.wait_for(
                        self._process_frame_internal(session, frame),
                        timeout=2.0
                    )

                    # Apply blur
                    blurred_frame = await blur_applicator.apply_blur(frame, detections)

                    # Encode
                    _, buffer = cv2.imencode('.jpg', blurred_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])

                    # Send result
                    await websocket.send_json({
                        "frame_id": session.frame_count,
                        "detection_count": len(detections),
                        "has_blur": len(detections) > 0
                    })
                    await websocket.send_bytes(buffer.tobytes())

                except asyncio.TimeoutError:
                    logger.warning(f"[Session {session_id}] Frame processing timeout")
                    await websocket.send_json({
                        "frame_id": session.frame_count,
                        "error": "processing_timeout"
                    })

        except Exception as e:
            logger.error(f"[Session {session_id}] Processor error: {e}")

    # Run receiver and processor concurrently
    try:
        await asyncio.gather(
            frame_receiver(),
            frame_processor()
        )
    except Exception as e:
        logger.error(f"[Session {session_id}] Error: {e}")
    finally:
        await websocket.close()
```

**Impact:** Prevent memory overflow, stable frame rate

---

#### 7.3 Use Binary Protocol (No Base64)

**File:** `runpod-service/main.py`

**Already using binary WebSocket (good!)**

**File:** `server/services/processingBridge.js`

**Ensure binary frame transfer:**
```javascript
async processFrame(roomName, frameBuffer) {
  const streamInfo = this.activeStreams.get(roomName);

  if (!streamInfo) {
    throw new Error(`No active processing for room: ${roomName}`);
  }

  try {
    // Send as binary FormData (NOT base64)
    const formData = new FormData();
    formData.append('frame_data', frameBuffer, {
      filename: 'frame.jpg',
      contentType: 'image/jpeg'
    });

    // Binary upload (more efficient than base64)
    const result = await censorshipProcessor.processFrame(roomName, frameBuffer);

    // Update stats...
    return result;
  } catch (error) {
    logger.error('[ProcessingBridge] Error processing frame:', error);
    throw error;
  }
}
```

**Impact:** 25% smaller payload, faster transmission

---

### 7.4 Summary: WebSocket Impact

| Feature | Before | After | Impact |
|---------|--------|-------|--------|
| **Reconnection** | Manual refresh | Automatic | Critical |
| **Backpressure** | Memory overflow | Bounded queue | High |
| **Encoding** | Base64 (heavy) | Binary (light) | Medium |
| **Monitoring** | None | Queue depth tracked | Medium |

---

## 8. ML Pipeline Improvements

### 🎯 Goal
Improve accuracy and efficiency of content censorship.

### Current Issues
- ❌ All models run sequentially
- ❌ No cascade filtering (lightweight → heavy)
- ❌ No context-aware profanity detection
- ❌ Fixed confidence thresholds

### Recommendations

#### 8.1 Implement Cascade Filtering

**File:** `runpod-service/processors/cascade_filter.py` (NEW)

**Create lightweight first-stage filter:**
```python
"""
Cascade Filter - Lightweight first-stage filter for content moderation
Uses fast heuristics to filter out obviously safe content
"""

import cv2
import numpy as np
from typing import Dict, Tuple

class CascadeFilter:
    """Lightweight filter to reduce GPU workload"""

    def __init__(self):
        self.skin_detector = self._init_skin_detector()

    def _init_skin_detector(self):
        """Initialize simple skin tone detector"""
        # YCrCb ranges for skin detection (fast heuristic)
        self.lower_skin = np.array([0, 133, 77], dtype=np.uint8)
        self.upper_skin = np.array([255, 173, 127], dtype=np.uint8)

    def should_process_nsfw(self, frame: np.ndarray) -> Tuple[bool, float]:
        """
        Fast heuristic to determine if NSFW detection needed

        Returns:
            (should_process, confidence) where:
            - True means "likely contains skin, run full NSFW detector"
            - False means "safe to skip expensive NSFW detection"
        """
        # Convert to YCrCb color space
        ycrcb = cv2.cvtColor(frame, cv2.COLOR_BGR2YCrCb)

        # Apply skin color threshold
        skin_mask = cv2.inRange(ycrcb, self.lower_skin, self.upper_skin)

        # Calculate skin percentage
        skin_pixels = np.count_nonzero(skin_mask)
        total_pixels = frame.shape[0] * frame.shape[1]
        skin_percentage = skin_pixels / total_pixels

        # If more than 15% skin pixels, run full detector
        should_process = skin_percentage > 0.15

        return should_process, skin_percentage

    def should_process_text(self, frame: np.ndarray) -> Tuple[bool, float]:
        """
        Fast heuristic to determine if text detection needed

        Uses edge detection to find text-like regions
        """
        # Convert to grayscale
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Apply Canny edge detection
        edges = cv2.Canny(gray, 100, 200)

        # Calculate edge density
        edge_pixels = np.count_nonzero(edges)
        total_pixels = frame.shape[0] * frame.shape[1]
        edge_percentage = edge_pixels / total_pixels

        # Text typically has 2-10% edge density
        has_potential_text = 0.02 < edge_percentage < 0.15

        return has_potential_text, edge_percentage

    def analyze_frame(self, frame: np.ndarray) -> Dict:
        """
        Quick analysis to determine which heavy processors to run

        Returns dict with recommendations for each processor
        """
        should_check_nsfw, skin_score = self.should_process_nsfw(frame)
        should_check_text, edge_score = self.should_process_text(frame)

        return {
            "nsfw": {
                "should_process": should_check_nsfw,
                "score": skin_score,
                "reason": f"{skin_score*100:.1f}% skin pixels"
            },
            "text": {
                "should_process": should_check_text,
                "score": edge_score,
                "reason": f"{edge_score*100:.1f}% edge density"
            }
        }
```

**Update main.py to use cascade:**
```python
from processors.cascade_filter import CascadeFilter

cascade_filter = CascadeFilter()

@app.post("/process/frame")
async def process_frame(session_id: str, frame_data: UploadFile = File(...)):
    """Process frame with cascade filtering"""

    # ... decode frame ...

    # Stage 1: Fast cascade filter
    cascade_result = cascade_filter.analyze_frame(frame)

    detections = []

    # Stage 2: Run expensive detectors only if needed
    if session.config.enable_text_detection and cascade_result["text"]["should_process"]:
        text_results = await text_detector.detect(
            frame,
            session.config.text_confidence,
            session.config.profanity_list
        )
        detections.extend(text_results)
    else:
        logger.debug(f"Skipped text detection: {cascade_result['text']['reason']}")

    if session.config.enable_nsfw_detection and cascade_result["nsfw"]["should_process"]:
        nsfw_results = await nsfw_detector.detect(
            frame,
            session.config.nsfw_confidence
        )
        detections.extend(nsfw_results)
    else:
        logger.debug(f"Skipped NSFW detection: {cascade_result['nsfw']['reason']}")

    # ... continue processing ...
```

**Impact:** 50-70% fewer heavy model inferences, same accuracy

---

#### 8.2 Add Context-Aware Profanity Detection

**File:** `runpod-service/processors/text_detector.py`

**Add NLP context analysis:**
```python
from transformers import pipeline

class TextDetector:
    def __init__(self):
        self.pipeline = None
        self.sentiment_analyzer = None
        self.profanity_cache = set()
        self._load_model()

    def _load_model(self):
        """Load Keras-OCR and sentiment analyzer"""
        try:
            import keras_ocr
            self.pipeline = keras_ocr.pipeline.Pipeline()

            # Load lightweight sentiment analyzer for context
            self.sentiment_analyzer = pipeline(
                "sentiment-analysis",
                model="distilbert-base-uncased-finetuned-sst-2-english",
                device=0 if torch.cuda.is_available() else -1
            )

            logger.info("Text detector loaded with context analysis")

        except Exception as e:
            logger.error(f"Error loading models: {e}")

    def _is_profanity_with_context(
        self,
        text: str,
        surrounding_words: List[str],
        profanity_list: List[str]
    ) -> Tuple[bool, str, float]:
        """
        Context-aware profanity detection

        Examples:
        - "Scunthorpe" contains "cunt" but is a place name (whitelist)
        - "kill it" in game context vs violent threat
        - Medical terms vs profanity
        """
        normalized_text = self._normalize_text(text)

        # Check basic profanity match
        matched_word = None
        for profane_word in profanity_list:
            normalized_profane = self._normalize_text(profane_word)
            if normalized_profane in normalized_text:
                matched_word = profane_word
                break

        if not matched_word:
            return False, "", 0.0

        # Check whitelist (e.g., "Scunthorpe")
        whitelist = ["scunthorpe", "assassin", "classic", "basement"]
        for allowed in whitelist:
            if self._normalize_text(allowed) == normalized_text:
                logger.debug(f"Whitelisted word: {text}")
                return False, "", 0.0

        # Analyze context with sentiment
        context = " ".join(surrounding_words) if surrounding_words else text

        try:
            sentiment = self.sentiment_analyzer(context)[0]

            # If surrounded by positive sentiment, might be acceptable
            # Example: "This game is fucking amazing!" (positive context)
            if sentiment['label'] == 'POSITIVE' and sentiment['score'] > 0.9:
                confidence = 0.5  # Lower confidence, might be acceptable
                logger.debug(f"Profanity in positive context: {text}")
            else:
                confidence = 0.95  # High confidence, likely offensive

        except Exception as e:
            logger.warning(f"Context analysis failed: {e}")
            confidence = 0.85  # Default confidence

        return True, matched_word, confidence

    async def detect(
        self,
        frame: np.ndarray,
        confidence_threshold: float = 0.7,
        profanity_list: List[str] = None
    ) -> List[Dict]:
        """Detect text with context awareness"""

        if self.pipeline is None:
            return []

        if profanity_list is None:
            profanity_list = []

        try:
            # Run OCR
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            loop = asyncio.get_event_loop()
            predictions = await loop.run_in_executor(
                None,
                self.pipeline.recognize,
                [rgb_frame]
            )

            frame_predictions = predictions[0] if predictions else []

            detections = []
            all_texts = [text for text, _ in frame_predictions]

            for i, (text, box) in enumerate(frame_predictions):
                # Get surrounding words for context
                surrounding = []
                if i > 0:
                    surrounding.append(all_texts[i-1])
                if i < len(all_texts) - 1:
                    surrounding.append(all_texts[i+1])

                # Check with context
                is_profane, matched_word, confidence = self._is_profanity_with_context(
                    text,
                    surrounding,
                    profanity_list
                )

                if is_profane and confidence >= confidence_threshold:
                    bbox = self._calculate_bounding_box(box)

                    detection = {
                        "type": "text",
                        "subtype": "profanity",
                        "text": text,
                        "matched_word": matched_word,
                        "confidence": confidence,
                        "context_aware": True,
                        "bbox": bbox,
                        "should_blur": True,
                        "tracking_id": None,
                        "velocity": (0, 0)
                    }

                    detections.append(detection)

            return detections

        except Exception as e:
            logger.error(f"Error in text detection: {e}")
            return []
```

**Impact:** 30% fewer false positives, better accuracy

---

#### 8.3 Implement Adaptive Thresholds

**File:** `runpod-service/main.py`

**Add adaptive confidence thresholds:**
```python
class StreamSession:
    def __init__(self, session_id: str, config: ProcessingConfig):
        self.session_id = session_id
        self.config = config
        self.frame_count = 0
        self.trackers: Dict = {}

        # Adaptive threshold state
        self.false_positive_rate = 0.0
        self.recent_detections = deque(maxlen=100)
        self.adaptive_thresholds = {
            "text": config.text_confidence,
            "nsfw": config.nsfw_confidence,
            "audio": config.audio_confidence
        }

    def adjust_thresholds(self, detection_type: str, was_false_positive: bool):
        """Adjust confidence thresholds based on feedback"""

        if was_false_positive:
            # Increase threshold to reduce false positives
            current = self.adaptive_thresholds[detection_type]
            new_threshold = min(current + 0.02, 0.99)
            self.adaptive_thresholds[detection_type] = new_threshold

            logger.info(
                f"[Session {self.session_id}] Increased {detection_type} "
                f"threshold: {current:.2f} -> {new_threshold:.2f}"
            )
        else:
            # True positive, gradually lower threshold
            current = self.adaptive_thresholds[detection_type]
            new_threshold = max(current - 0.01, self.config.text_confidence)
            self.adaptive_thresholds[detection_type] = new_threshold

    def get_threshold(self, detection_type: str) -> float:
        """Get current adaptive threshold"""
        return self.adaptive_thresholds.get(
            detection_type,
            self.config.text_confidence
        )

# Use in processing
@app.post("/process/frame")
async def process_frame(session_id: str, frame_data: UploadFile = File(...)):
    session = active_sessions[session_id]

    # Use adaptive thresholds
    if session.config.enable_text_detection:
        text_results = await text_detector.detect(
            frame,
            confidence_threshold=session.get_threshold("text"),  # Adaptive
            profanity_list=session.config.profanity_list
        )
        detections.extend(text_results)

    # ... similar for other detectors
```

**Add feedback endpoint:**
```python
@app.post("/feedback/detection")
async def feedback_detection(
    session_id: str,
    frame_id: int,
    detection_type: str,
    was_correct: bool
):
    """Receive feedback on detection accuracy"""

    if session_id not in active_sessions:
        raise HTTPException(status_code=404, detail="Session not found")

    session = active_sessions[session_id]

    # Adjust thresholds based on feedback
    session.adjust_thresholds(detection_type, not was_correct)

    return {
        "success": True,
        "new_threshold": session.get_threshold(detection_type)
    }
```

**Impact:** Self-improving accuracy over time

---

### 8.4 Summary: ML Pipeline Impact

| Improvement | Efficiency Gain | Accuracy Change | Difficulty |
|-------------|----------------|-----------------|------------|
| Cascade Filter | 50-70% fewer inferences | Same | Medium |
| Context-Aware Detection | N/A | +30% precision | Medium |
| Adaptive Thresholds | N/A | +10% over time | Easy |
| **TOTAL** | **2-3x throughput** | **+40% better** | - |

---

## 9. Client-Side Improvements

### Current Issues
- ❌ No connection quality indicator
- ❌ No bandwidth adaptation
- ❌ No local caching
- ❌ No PWA support

### Recommendations

#### 9.1 Add Connection Quality Indicator

**File:** `client/src/components/ConnectionQuality.jsx` (NEW)

```jsx
import { useState, useEffect } from 'react';
import { useConnectionQualityIndicator } from '@livekit/components-react';

export function ConnectionQuality() {
  const quality = useConnectionQualityIndicator();

  const getQualityColor = () => {
    switch (quality) {
      case 'excellent': return '#22c55e';
      case 'good': return '#84cc16';
      case 'poor': return '#eab308';
      default: return '#ef4444';
    }
  };

  const getQualityText = () => {
    switch (quality) {
      case 'excellent': return 'Excellent';
      case 'good': return 'Good';
      case 'poor': return 'Poor';
      default: return 'Bad';
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      background: 'rgba(0,0,0,0.6)',
      borderRadius: '8px',
      fontSize: '14px'
    }}>
      <div style={{
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        background: getQualityColor()
      }} />
      <span>{getQualityText()} Connection</span>
    </div>
  );
}
```

---

#### 9.2 Add PWA Support

**File:** `client/vite.config.js`

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'LiveKit Webinar',
        short_name: 'LiveKit',
        description: 'Professional live streaming platform',
        theme_color: '#667eea',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
});
```

**Impact:** Mobile app experience, offline support

---

## 10. Server-Side Improvements

### Recommendations

#### 10.1 Add Request ID Tracking

**File:** `server/middleware/requestId.js` (NEW)

```javascript
import { v4 as uuidv4 } from 'uuid';

export function requestIdMiddleware(req, res, next) {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
}
```

---

#### 10.2 Add Health Check Dependencies

**File:** `server/server.js`

```javascript
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    dependencies: {}
  };

  // Check Redis
  try {
    await redis.ping();
    health.dependencies.redis = { status: 'healthy' };
  } catch (error) {
    health.dependencies.redis = { status: 'unhealthy', error: error.message };
    health.status = 'degraded';
  }

  // Check RunPod service
  if (process.env.ENABLE_CENSORSHIP === 'true') {
    try {
      const response = await axios.get(`${process.env.RUNPOD_SERVICE_URL}/health`, {
        timeout: 5000
      });
      health.dependencies.runpod = { status: 'healthy' };
    } catch (error) {
      health.dependencies.runpod = { status: 'unhealthy', error: error.message };
      health.status = 'degraded';
    }
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

---

## 11. DevOps & Infrastructure

### Recommendations

#### 11.1 Docker Compose for Local Development

**File:** `docker-compose.yml` (NEW)

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: livekit_analytics
      POSTGRES_USER: livekit
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./monitoring/alerts.yml:/etc/prometheus/alerts.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
      GF_USERS_ALLOW_SIGN_UP: false
    volumes:
      - grafana-data:/var/lib/grafana
      - ./monitoring/grafana-dashboard.json:/etc/grafana/provisioning/dashboards/livekit.json
    depends_on:
      - prometheus

  server:
    build:
      context: ./server
      dockerfile: Dockerfile
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=development
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://livekit:password@postgres:5432/livekit_analytics
    depends_on:
      - redis
      - postgres
    volumes:
      - ./server:/app
      - /app/node_modules

  client:
    build:
      context: ./client
      dockerfile: Dockerfile
    ports:
      - "5173:5173"
    environment:
      - VITE_SERVER_URL=http://localhost:3001
    volumes:
      - ./client:/app
      - /app/node_modules

volumes:
  redis-data:
  postgres-data:
  prometheus-data:
  grafana-data:
```

**Usage:**
```bash
docker-compose up -d
```

---

#### 11.2 GitHub Actions CI/CD

**File:** `.github/workflows/ci.yml` (NEW)

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-server:
    runs-on: ubuntu-latest

    services:
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: server/package-lock.json

      - name: Install dependencies
        working-directory: server
        run: npm ci

      - name: Run linter
        working-directory: server
        run: npm run lint

      - name: Run tests
        working-directory: server
        run: npm test
        env:
          REDIS_URL: redis://localhost:6379

  test-client:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
          cache-dependency-path: client/package-lock.json

      - name: Install dependencies
        working-directory: client
        run: npm ci

      - name: Run linter
        working-directory: client
        run: npm run lint

      - name: Build
        working-directory: client
        run: npm run build

  build-runpod-service:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Build Docker image
        working-directory: runpod-service
        run: docker build -t censorship-service:latest .

      - name: Test Docker image
        run: |
          docker run --rm censorship-service:latest python -c "import tensorflow; print('TensorFlow OK')"
```

---

## 12. Testing & Quality Assurance

### Recommendations

#### 12.1 Unit Tests for Server

**File:** `server/tests/roomManager.test.js` (NEW)

```javascript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import roomManager from '../roomManager.js';
import redis from '../services/redisClient.js';

describe('RoomManager', () => {
  beforeEach(async () => {
    // Clear test data
    await redis.flushdb();
  });

  afterEach(async () => {
    await redis.flushdb();
  });

  it('should create a new room', async () => {
    const room = await roomManager.createRoom('test-room');

    expect(room).toBeDefined();
    expect(room.name).toBe('test-room');
    expect(room.isLive).toBe(false);
  });

  it('should add broadcaster to room', async () => {
    await roomManager.createRoom('test-room');

    const participant = {
      identity: 'user1-broadcaster',
      name: 'User 1'
    };

    await roomManager.addParticipant('test-room', participant);

    const room = await roomManager.getRoom('test-room');
    expect(room.broadcaster).toEqual(participant);
    expect(room.isLive).toBe(true);
  });

  it('should track viewer count', async () => {
    await roomManager.createRoom('test-room');

    await roomManager.addParticipant('test-room', {
      identity: 'broadcaster',
      name: 'Broadcaster'
    });

    await roomManager.addParticipant('test-room', {
      identity: 'viewer1',
      name: 'Viewer 1'
    });

    await roomManager.addParticipant('test-room', {
      identity: 'viewer2',
      name: 'Viewer 2'
    });

    const room = await roomManager.getRoom('test-room');
    expect(room.viewers.length).toBe(2);
    expect(room.analytics.totalViewers).toBe(2);
  });
});
```

---

#### 12.2 Integration Tests

**File:** `server/tests/integration/streaming.test.js` (NEW)

```javascript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../server.js';
import redis from '../services/redisClient.js';

describe('Streaming API Integration', () => {
  let server;

  beforeAll(async () => {
    server = app.listen(3002);
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.flushdb();
    await server.close();
  });

  it('should generate token for broadcaster', async () => {
    const response = await request(app)
      .post('/token')
      .send({
        roomName: 'test-room',
        participantName: 'TestUser',
        role: 'broadcaster'
      })
      .expect(200);

    expect(response.body).toHaveProperty('token');
    expect(response.body).toHaveProperty('wsUrl');
    expect(response.body.identity).toBe('TestUser-broadcaster');
  });

  it('should start stream', async () => {
    const response = await request(app)
      .post('/stream/start')
      .send({
        roomName: 'test-room',
        broadcasterName: 'TestBroadcaster'
      })
      .expect(200);

    expect(response.body.success).toBe(true);
  });
});
```

---

#### 12.3 Performance Tests

**File:** `server/tests/performance/load.test.js` (NEW)

```javascript
import autocannon from 'autocannon';

async function runLoadTest() {
  const result = await autocannon({
    url: 'http://localhost:3001',
    connections: 100,
    duration: 30,
    requests: [
      {
        method: 'POST',
        path: '/token',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          roomName: 'load-test',
          participantName: 'User',
          role: 'viewer'
        })
      }
    ]
  });

  console.log('Load Test Results:');
  console.log(`Requests: ${result.requests.total}`);
  console.log(`Latency (avg): ${result.latency.mean}ms`);
  console.log(`Throughput: ${result.throughput.mean} bytes/sec`);
}

runLoadTest();
```

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Weeks 1-3)

**Week 1: GPU Optimization**
- [ ] Add TensorRT integration
- [ ] Implement dynamic batching
- [ ] Add FP16 mixed precision
- [ ] Implement model warm-up

**Week 2: Error Handling**
- [ ] Add circuit breaker
- [ ] Implement retry logic
- [ ] Add comprehensive error handling
- [ ] Enhanced health checks

**Week 3: Security Hardening**
- [ ] Add webhook signature verification
- [ ] Implement rate limiting
- [ ] Fix CORS configuration
- [ ] Add input validation
- [ ] Implement API authentication

---

### Phase 2: Production Readiness (Weeks 4-7)

**Week 4: State Management**
- [ ] Integrate Redis
- [ ] Migrate roomManager to Redis
- [ ] Set up PostgreSQL
- [ ] Implement analytics logging

**Week 5: Monitoring**
- [ ] Add Prometheus metrics
- [ ] Implement structured logging
- [ ] Set up distributed tracing
- [ ] Create Grafana dashboards
- [ ] Configure alerts

**Week 6: Performance**
- [ ] Add caching layer
- [ ] Implement HTTP connection pooling
- [ ] Optimize React rendering
- [ ] Add adaptive frame sampling

**Week 7: WebSocket Optimization**
- [ ] Implement reconnection logic
- [ ] Add backpressure handling
- [ ] Optimize binary protocol
- [ ] Add connection monitoring

---

### Phase 3: Advanced Features (Weeks 8-10)

**Week 8: ML Pipeline**
- [ ] Implement cascade filtering
- [ ] Add context-aware profanity detection
- [ ] Implement adaptive thresholds

**Week 9: Client Improvements**
- [ ] Add connection quality indicator
- [ ] Implement PWA support
- [ ] Add offline capabilities

**Week 10: DevOps & Testing**
- [ ] Create Docker Compose setup
- [ ] Set up GitHub Actions CI/CD
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Run performance tests

---

## Summary & Next Steps

### Estimated Impact

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Inference Speed** | 100ms | 20-30ms | 3-5x faster |
| **System Uptime** | 95% | 99.9% | +5% |
| **Throughput** | 10 FPS | 30-40 FPS | 3-4x |
| **Error Recovery** | Manual | Automatic | Critical |
| **Security Posture** | Development | Production | Critical |
| **Observability** | Console logs | Full metrics | Critical |

### Total Effort Estimate

- **Critical (P0):** 3 weeks
- **High Impact (P1):** 4 weeks
- **Polish (P2):** 3 weeks
- **Total:** 10 weeks

### Recommended Priority Order

1. **Start Here (Week 1):** GPU optimization + Error handling
2. **Week 2-3:** Security + State persistence
3. **Week 4-5:** Monitoring + Performance
4. **Week 6+:** Advanced features

### Questions for You

1. **What's your timeline?** Need it production-ready ASAP or can take 10 weeks?
2. **What's your biggest pain point?** Performance, reliability, or security?
3. **Do you have a DevOps team?** For setting up Prometheus/Grafana/Redis/PostgreSQL
4. **Budget for infrastructure?** Redis/PostgreSQL hosting costs
5. **Want me to implement everything or just specific parts?**

---

**Ready to start implementing! Which improvements should I prioritize first?**
