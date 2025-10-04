# Triton Inference Server Setup

This directory contains Triton model configurations for optimized inference.

## Quick Start

### 1. Convert NudeNet to TensorRT

```bash
# From runpod-service directory
cd optimizers

# Install dependencies
pip install tensorrt pycuda onnx

# Convert model (includes ONNX export + TensorRT build)
python convert_to_tensorrt.py \
  --export-onnx \
  --precision FP16 \
  --batch-size 8 \
  --test

# Copy engine to Triton model repository
cp nudenet_trt.plan ../triton/models/nudenet_trt/1/model.plan
```

### 2. Start Triton Server

```bash
# Option A: Docker (recommended)
docker run --gpus all --rm \
  -p 8000:8000 -p 8001:8001 -p 8002:8002 \
  -v $(pwd)/triton/models:/models \
  nvcr.io/nvidia/tritonserver:23.10-py3 \
  tritonserver --model-repository=/models

# Option B: Local install
tritonserver --model-repository=./triton/models
```

### 3. Verify Server

```bash
# Check server health
curl http://localhost:8000/v2/health/ready

# List models
curl http://localhost:8000/v2/models

# Get model metadata
curl http://localhost:8000/v2/models/nudenet_trt
```

## Model Configuration

### NudeNet TensorRT (`nudenet_trt`)

**Input:**
- Name: `input`
- Type: `FP32`
- Shape: `[batch, 3, 180, 320]` (downsampled from 720p)
- Format: RGB, normalized [0-1]

**Output:**
- Name: `output`
- Type: `FP32`
- Shape: `[batch, num_detections, 6]`
- Format: `[x1, y1, x2, y2, class_id, confidence]`

**Batching:**
- Max batch size: 8
- Preferred: 4, 8
- Max queue delay: 30ms
- Out-of-order responses: Enabled

**Instances:**
- Count: 3 (prevents blocking)
- GPU: 0

**Optimizations:**
- Precision: FP16 (3-5x speedup)
- Workspace: 2GB
- Pinned memory: Enabled

## Performance

### Expected Latency

| Batch Size | FP32 (ms) | FP16 (ms) | Speedup |
|------------|-----------|-----------|---------|
| 1 | 150-200 | **40-50** | 3-4x |
| 4 | 400-500 | **80-120** | 4-5x |
| 8 | 800-1000 | **150-200** | 5-6x |

### Throughput

- **Single instance:** ~200 FPS (batch 8, FP16)
- **3 instances:** ~500-600 FPS total
- **Per stream:** 30 FPS detection (5-8 concurrent streams)

## gRPC Client Integration

### Node.js Example

```javascript
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

// Load Triton proto
const packageDefinition = protoLoader.loadSync(
  'triton/service.proto',
  { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
);

const triton = grpc.loadPackageDefinition(packageDefinition).inference;

// Create client
const client = new triton.GRPCInferenceService(
  'localhost:8001',
  grpc.credentials.createInsecure()
);

// Infer request
const request = {
  model_name: 'nudenet_trt',
  inputs: [{
    name: 'input',
    datatype: 'FP32',
    shape: [batch_size, 3, 180, 320],
    contents: { fp32_contents: frameData }
  }]
};

client.ModelInfer(request, (err, response) => {
  if (err) console.error(err);
  else console.log('Detections:', response.outputs[0]);
});
```

## Monitoring

### Server Metrics

```bash
# Prometheus metrics
curl http://localhost:8002/metrics

# Key metrics:
# - nv_inference_request_success
# - nv_inference_request_duration_us
# - nv_inference_queue_duration_us
# - nv_inference_compute_infer_duration_us
```

### Model Statistics

```bash
# Get model stats
curl http://localhost:8000/v2/models/nudenet_trt/stats
```

## Troubleshooting

### Engine Build Fails

**Issue:** TensorRT build fails with "out of memory"

**Solution:**
```bash
# Reduce workspace size
python convert_to_tensorrt.py --workspace 1  # 1GB instead of 2GB
```

### Slow Inference

**Issue:** Inference taking >100ms per batch

**Solutions:**
1. Check precision mode (should be FP16):
   ```bash
   grep precision_mode triton/models/nudenet_trt/config.pbtxt
   ```

2. Verify GPU usage:
   ```bash
   nvidia-smi -l 1
   ```

3. Check batch size (4-8 optimal):
   ```bash
   # Server logs should show preferred batch sizes
   docker logs <container_id> | grep "preferred_batch_size"
   ```

### Queue Overflow

**Issue:** Frames being dropped due to queue overflow

**Solutions:**
1. Increase instances:
   ```protobuf
   instance_group [{ count: 4 }]  # 3 → 4
   ```

2. Reduce max queue delay:
   ```protobuf
   max_queue_delay_microseconds: 20000  # 30ms → 20ms
   ```

3. Add priority queues (future enhancement)

## Advanced: INT8 Quantization

For 8x speedup (requires calibration):

```bash
# 1. Collect calibration data (500-1000 frames)
python collect_calibration_data.py --output calib_data.npy

# 2. Convert with INT8
python convert_to_tensorrt.py \
  --precision INT8 \
  --calibration-data calib_data.npy

# Expected: 100-500ms → 15-25ms
```

## References

- [Triton Inference Server Docs](https://docs.nvidia.com/deeplearning/triton-inference-server)
- [TensorRT Developer Guide](https://docs.nvidia.com/deeplearning/tensorrt/developer-guide)
- [ONNX Runtime TensorRT Provider](https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html)
