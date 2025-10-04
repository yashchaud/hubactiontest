# Documentation Index

Quick reference to all documentation for the Hybrid 3-Lane Architecture.

---

## 🚀 Getting Started

### [QUICK_START.md](./QUICK_START.md)
**5-minute setup guide**
- Prerequisites and dependencies
- Environment configuration
- Start services (mock and production modes)
- Test the pipeline
- Performance verification

**When to use**: First-time setup, quick testing

---

## 📚 Core Documentation

### [README.md](./README.md)
**Project overview**
- Features and capabilities
- Architecture diagram
- API endpoints
- Quick start commands
- Environment configuration

**When to use**: Understanding the project, API reference

### [HYBRID_ARCHITECTURE.md](./HYBRID_ARCHITECTURE.md)
**Technical deep dive**
- 3-lane architecture details
- Lane 1: Live Path (<30ms)
- Lane 2: Async Verification (50-200ms)
- Lane 3: Tracking & Update (2-5ms)
- Performance characteristics
- Scaling strategy

**When to use**: Understanding the architecture, performance tuning

### [CLAUDE.md](./CLAUDE.md)
**AI assistant guide**
- Project structure
- Key flows
- LiveKit SDK usage
- Common patterns
- Important notes

**When to use**: Working with Claude Code, understanding codebase

---

## ⚙️ Configuration

### [SETUP_GUIDE.md](./SETUP_GUIDE.md)
**Complete configuration reference**
- Quick start (5 minutes)
- Environment variables
- Triton Inference Server setup
- Production deployment
- Troubleshooting

**When to use**: Detailed setup, production deployment, troubleshooting

---

## 🧪 Testing

### [TESTING_GUIDE.md](./TESTING_GUIDE.md)
**Comprehensive testing suite**
- Test scenarios (5 tests)
- Performance validation
- Troubleshooting guide
- Load testing (5-8 streams)
- Before/after comparison

**When to use**: Testing the implementation, performance validation

### Test Scripts

#### [test-webhook.js](./test-webhook.js)
**Webhook integration test**
```bash
# Test environment
node test-webhook.js config

# Test full pipeline
node test-webhook.js full

# Check agent status
node test-webhook.js status
```

#### [test-tensorrt.py](./test-tensorrt.py)
**TensorRT optimization test**
```bash
# Run complete test suite
python test-tensorrt.py
```

---

## 📊 Implementation Status

### [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)
**Complete implementation overview**
- All 4 phases documented
- Performance achievements
- Architecture flow
- Key innovations
- Files summary
- Next steps

**When to use**: Understanding what's been built, current status

### [IMPLEMENTATION_COMPLETE.md](./IMPLEMENTATION_COMPLETE.md)
**Final achievement summary**
- What's been accomplished
- Performance metrics
- Visual pipeline flow
- Before/after comparison
- Next actions

**When to use**: Quick status check, sharing results

### [IMPLEMENTATION_PROGRESS.md](./IMPLEMENTATION_PROGRESS.md)
**Phase-by-phase tracking**
- Phase 1: Cleanup ✅
- Phase 2: Core ✅
- Phase 3: Optimization ✅
- Phase 4: Integration ✅
- Phases 5-7: Pending

**When to use**: Tracking progress, understanding phases

---

## 📁 File Reference

### Core Components

| File | Lines | Purpose |
|------|-------|---------|
| [server/core/ContinuousBatchCollector.js](server/core/ContinuousBatchCollector.js) | 175 | Async batching (Lane 2) |
| [server/core/LivePublisher.js](server/core/LivePublisher.js) | 280 | <30ms publishing (Lane 1) |
| [server/core/AsyncVerifier.js](server/core/AsyncVerifier.js) | 350 | Triton gRPC client (Lane 2) |
| [server/tracking/KalmanTracker.js](server/tracking/KalmanTracker.js) | 315 | Predictive tracking (Lane 3) |
| [server/tracking/ConfidenceDecay.js](server/tracking/ConfidenceDecay.js) | 195 | Temporal smoothing (Lane 3) |
| [server/services/censorshipAgentHybrid.js](server/services/censorshipAgentHybrid.js) | 650 | 3-lane orchestrator |

### Optimization

| File | Lines | Purpose |
|------|-------|---------|
| [runpod-service/optimizers/convert_to_tensorrt.py](runpod-service/optimizers/convert_to_tensorrt.py) | 380 | TensorRT FP16 converter |
| [runpod-service/triton/models/nudenet_trt/config.pbtxt](runpod-service/triton/models/nudenet_trt/config.pbtxt) | 120 | Triton configuration |
| [runpod-service/triton/README.md](runpod-service/triton/README.md) | 150 | Triton setup guide |

### Integration

| File | Lines | Purpose |
|------|-------|---------|
| [server/webhooks.js](server/webhooks.js) | 393 | Webhook event handling |
| [server/services/censorshipAgentHybrid.js](server/services/censorshipAgentHybrid.js) | 650 | Hybrid agent integration |

---

## 🎯 Quick Navigation

### I want to...

**Get started quickly**
→ [QUICK_START.md](./QUICK_START.md)

**Understand the architecture**
→ [HYBRID_ARCHITECTURE.md](./HYBRID_ARCHITECTURE.md)

**Configure the system**
→ [SETUP_GUIDE.md](./SETUP_GUIDE.md)

**Test the implementation**
→ [TESTING_GUIDE.md](./TESTING_GUIDE.md)

**See what's been built**
→ [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)

**Troubleshoot issues**
→ [SETUP_GUIDE.md#troubleshooting](./SETUP_GUIDE.md#troubleshooting)
→ [TESTING_GUIDE.md#troubleshooting](./TESTING_GUIDE.md#troubleshooting)

**Deploy to production**
→ [SETUP_GUIDE.md#production-deployment](./SETUP_GUIDE.md#production-deployment)

**Work with the codebase**
→ [CLAUDE.md](./CLAUDE.md)

**Review API endpoints**
→ [README.md#api-endpoints](./README.md#api-endpoints)

---

## 📈 Performance Reference

### Targets

| Metric | Target | Location |
|--------|--------|----------|
| Publish Latency | <30ms | Lane 1 |
| Verify Latency | <200ms | Lane 2 |
| Frame Rate | 30 FPS | End-to-end |
| Frame Leaks | 0 | Lane 1 (optimistic blur) |
| Tracking Accuracy | 96.8% | Lane 3 (Kalman) |
| Concurrent Streams | 5-8 | Multi-GPU |
| GPU Utilization | 85-90% | Triton batching |

### Validation Commands

```bash
# Check Lane 1 latency
curl http://localhost:3001/censorship/processing | jq '.activeRooms[0].lanes.lane1.avgLatencyMs'

# Check Lane 2 latency
curl http://localhost:3001/censorship/processing | jq '.activeRooms[0].lanes.lane2.avgLatencyMs'

# Check frame rate (should increase by 150 every 5s)
curl http://localhost:3001/censorship/processing | jq '.activeRooms[0].frameCount'

# Check active trackers
curl http://localhost:3001/censorship/processing | jq '.activeRooms[0].lanes.lane3.kalman.activeTrackers'
```

---

## 🔧 Configuration Reference

### Environment Variables (server/.env)

**Required**:
```env
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
LIVEKIT_WS_URL=wss://your-project.livekit.cloud
USE_HYBRID_AGENT=true
TRITON_GRPC_URL=localhost:8001
```

**Optional** (with defaults):
```env
KALMAN_ENABLED=true
BATCH_MAX_WAIT_MS=30
BATCH_SIZE=8
CONFIDENCE_DECAY_RATE=0.85
MIN_CONFIDENCE=0.3
BLUR_DILATION_PX=8
```

See [SETUP_GUIDE.md](./SETUP_GUIDE.md#environment-variables) for complete reference.

---

## 🐛 Common Issues

### Agent Not Connecting
**Solution**: [TESTING_GUIDE.md#issue-1-agent-not-connecting](./TESTING_GUIDE.md#issue-1-agent-not-connecting)

### High Lane 1 Latency
**Solution**: [TESTING_GUIDE.md#issue-2-high-lane-1-latency](./TESTING_GUIDE.md#issue-2-high-lane-1-latency)

### Triton Connection Failed
**Solution**: [TESTING_GUIDE.md#issue-3-triton-connection-failed](./TESTING_GUIDE.md#issue-3-triton-connection-failed)

### No Detections
**Solution**: [TESTING_GUIDE.md#issue-4-no-detections](./TESTING_GUIDE.md#issue-4-no-detections)

### Frame Leaks
**Solution**: [TESTING_GUIDE.md#issue-5-frame-leaks](./TESTING_GUIDE.md#issue-5-frame-leaks)

---

## 📞 Support Resources

### Documentation
1. [QUICK_START.md](./QUICK_START.md) - Setup guide
2. [SETUP_GUIDE.md](./SETUP_GUIDE.md) - Configuration
3. [TESTING_GUIDE.md](./TESTING_GUIDE.md) - Testing
4. [HYBRID_ARCHITECTURE.md](./HYBRID_ARCHITECTURE.md) - Technical details

### Testing
1. [test-webhook.js](./test-webhook.js) - Integration tests
2. [test-tensorrt.py](./test-tensorrt.py) - TensorRT validation

### Status
1. [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Complete overview
2. [IMPLEMENTATION_COMPLETE.md](./IMPLEMENTATION_COMPLETE.md) - Achievements
3. [IMPLEMENTATION_PROGRESS.md](./IMPLEMENTATION_PROGRESS.md) - Phase tracking

---

## 🎉 Quick Facts

- **Total Files**: 29 changed
- **Lines Added**: 9,328
- **Lines Removed**: 1,258
- **New Files**: 23
- **Commits**: 10
- **Phases Complete**: 4 of 7 (57%)
- **Status**: ✅ Ready for Testing

---

**Last Updated**: 2025-10-05
**Branch**: `feature/hybrid-pipeline`
**Version**: 1.0.0
