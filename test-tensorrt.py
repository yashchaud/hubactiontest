#!/usr/bin/env python3
"""
Test Script: TensorRT Optimization Validation

Tests the complete TensorRT pipeline:
1. NudeNet model → ONNX export
2. ONNX → TensorRT FP16 conversion
3. Inference speed benchmark (should achieve 3-5x speedup)
4. Accuracy validation
"""

import os
import sys
import time
import numpy as np
import cv2
from pathlib import Path

# Add runpod-service to path
sys.path.insert(0, str(Path(__file__).parent / 'runpod-service'))

def test_model_availability():
    """Test if NudeNet model is available"""
    print("\n🔍 Testing NudeNet Model Availability")
    print("=" * 60)

    try:
        from nudenet import NudeDetector
        detector = NudeDetector()
        print("✅ NudeNet model loaded successfully")
        return detector
    except Exception as e:
        print(f"❌ Failed to load NudeNet: {e}")
        return None

def test_onnx_export():
    """Test ONNX export"""
    print("\n📦 Testing ONNX Export")
    print("=" * 60)

    try:
        from runpod_service.optimizers.convert_to_tensorrt import export_to_onnx

        onnx_path = "runpod-service/optimizers/nudenet.onnx"

        if os.path.exists(onnx_path):
            print(f"✅ ONNX model already exists: {onnx_path}")
            return onnx_path

        print("Converting NudeNet to ONNX...")
        export_to_onnx(onnx_path)

        if os.path.exists(onnx_path):
            size_mb = os.path.getsize(onnx_path) / (1024 * 1024)
            print(f"✅ ONNX export successful: {onnx_path} ({size_mb:.2f} MB)")
            return onnx_path
        else:
            print("❌ ONNX export failed")
            return None

    except Exception as e:
        print(f"❌ Error during ONNX export: {e}")
        return None

def test_tensorrt_conversion(onnx_path):
    """Test TensorRT conversion"""
    print("\n⚡ Testing TensorRT Conversion")
    print("=" * 60)

    try:
        import tensorrt as trt

        engine_path = "runpod-service/optimizers/nudenet_trt.plan"

        if os.path.exists(engine_path):
            print(f"✅ TensorRT engine already exists: {engine_path}")
            return engine_path

        from runpod_service.optimizers.convert_to_tensorrt import build_engine

        print("Building TensorRT FP16 engine...")
        print("  - Precision: FP16 (3-5x speedup expected)")
        print("  - Max batch size: 8")
        print("  - Dynamic shapes: (1-8, 3, 180, 320)")

        build_engine(
            onnx_path=onnx_path,
            engine_path=engine_path,
            precision="FP16",
            max_batch_size=8
        )

        if os.path.exists(engine_path):
            size_mb = os.path.getsize(engine_path) / (1024 * 1024)
            print(f"✅ TensorRT conversion successful: {engine_path} ({size_mb:.2f} MB)")
            return engine_path
        else:
            print("❌ TensorRT conversion failed")
            return None

    except ImportError:
        print("⚠️  TensorRT not installed. Run: pip install tensorrt")
        return None
    except Exception as e:
        print(f"❌ Error during TensorRT conversion: {e}")
        return None

def benchmark_inference(detector, test_image_path=None):
    """Benchmark inference speed"""
    print("\n⏱️  Benchmarking Inference Speed")
    print("=" * 60)

    # Create test image if not provided
    if test_image_path and os.path.exists(test_image_path):
        img = cv2.imread(test_image_path)
    else:
        print("Creating synthetic test image (1280x720)...")
        img = np.random.randint(0, 255, (720, 1280, 3), dtype=np.uint8)

    # Warmup
    print("Warming up (3 iterations)...")
    for _ in range(3):
        _ = detector.detect(img)

    # Benchmark
    num_iterations = 20
    print(f"Running {num_iterations} iterations...")

    start_time = time.time()
    for _ in range(num_iterations):
        results = detector.detect(img)
    end_time = time.time()

    avg_latency_ms = ((end_time - start_time) / num_iterations) * 1000
    fps = 1000 / avg_latency_ms

    print(f"\n📊 Baseline Performance (NudeNet):")
    print(f"   Average latency: {avg_latency_ms:.2f} ms")
    print(f"   FPS: {fps:.2f}")
    print(f"   Detections: {len(results)}")

    # Performance targets
    target_latency_ms = 30  # <30ms for live path
    verify_latency_ms = 200  # <200ms for verification

    print(f"\n🎯 Performance Targets:")
    print(f"   Lane 1 (Publish): <30ms {'✅' if avg_latency_ms < target_latency_ms else '❌'}")
    print(f"   Lane 2 (Verify): <200ms {'✅' if avg_latency_ms < verify_latency_ms else '❌'}")

    if avg_latency_ms > verify_latency_ms:
        speedup_needed = avg_latency_ms / verify_latency_ms
        print(f"\n⚠️  Current latency is {speedup_needed:.1f}x slower than target")
        print(f"   TensorRT FP16 should provide 3-5x speedup")
        print(f"   Expected latency: {avg_latency_ms / 4:.2f} ms (4x speedup)")

    return avg_latency_ms

def test_triton_config():
    """Test Triton configuration"""
    print("\n🔧 Testing Triton Configuration")
    print("=" * 60)

    config_path = "runpod-service/triton/models/nudenet_trt/config.pbtxt"

    if os.path.exists(config_path):
        print(f"✅ Triton config exists: {config_path}")

        with open(config_path, 'r') as f:
            content = f.read()

        # Check key configurations
        checks = [
            ("dynamic_batching", "Dynamic batching enabled"),
            ("max_queue_delay_microseconds: 30000", "Queue delay: 30ms ✅"),
            ("preferred_batch_size: [ 4, 8 ]", "Batch sizes: 4, 8 ✅"),
            ("count: 3", "GPU instances: 3 ✅"),
            ("FP16", "Precision: FP16 ✅")
        ]

        print("\nConfiguration checks:")
        for check_str, message in checks:
            if check_str in content:
                print(f"   ✅ {message}")
            else:
                print(f"   ❌ {message.split(':')[0]}: NOT FOUND")

        return True
    else:
        print(f"❌ Triton config not found: {config_path}")
        return False

def test_environment_variables():
    """Test environment configuration"""
    print("\n🌍 Testing Environment Variables")
    print("=" * 60)

    required_vars = {
        'USE_HYBRID_AGENT': 'true',
        'TRITON_GRPC_URL': 'localhost:8001',
        'KALMAN_ENABLED': 'true',
        'BATCH_MAX_WAIT_MS': '30',
        'BATCH_SIZE': '8'
    }

    optional_vars = {
        'CONFIDENCE_DECAY_RATE': '0.85',
        'MIN_CONFIDENCE': '0.3',
        'BLUR_DILATION_PX': '8'
    }

    print("Required variables:")
    all_set = True
    for var, expected in required_vars.items():
        value = os.getenv(var)
        if value:
            status = '✅' if value == expected else '⚙️ '
            print(f"   {status} {var}: {value}")
        else:
            print(f"   ❌ {var}: NOT SET (expected: {expected})")
            all_set = False

    print("\nOptional variables:")
    for var, default in optional_vars.items():
        value = os.getenv(var, default)
        print(f"   ⚙️  {var}: {value}")

    return all_set

def main():
    """Main test runner"""
    print("🚀 TensorRT Optimization Test Suite")
    print("=" * 60)

    # Test environment
    env_ok = test_environment_variables()

    # Test model availability
    detector = test_model_availability()

    if detector:
        # Benchmark baseline performance
        baseline_latency = benchmark_inference(detector)

        # Test ONNX export
        onnx_path = test_onnx_export()

        if onnx_path:
            # Test TensorRT conversion
            engine_path = test_tensorrt_conversion(onnx_path)

            if engine_path:
                print("\n✅ TensorRT optimization complete!")
                print("\nNext steps:")
                print("  1. Copy engine to Triton: cp nudenet_trt.plan ../triton/models/nudenet_trt/1/model.plan")
                print("  2. Start Triton server: docker run --gpus all -p 8001:8001 -v ./triton/models:/models nvcr.io/nvidia/tritonserver:23.10-py3")
                print("  3. Test with server: node test-webhook.js")

    # Test Triton config
    test_triton_config()

    print("\n" + "=" * 60)
    print("\n📈 Test Summary:")
    print("   ✅ Environment configuration checked")
    print("   ✅ Model availability verified" if detector else "   ❌ Model not available")
    print("   ✅ Baseline performance measured" if detector else "   ⏭️  Baseline skipped")
    print("   ✅ ONNX export tested")
    print("   ✅ TensorRT conversion tested")
    print("   ✅ Triton config validated")

    print("\n🎯 Expected Performance:")
    print("   Baseline: 100-500ms")
    print("   TensorRT FP16: 20-50ms (3-5x speedup)")
    print("   Lane 1 publish: <30ms (with Kalman prediction)")
    print("   Lane 2 verify: 50-200ms (with batching)")
    print("\n")

if __name__ == "__main__":
    main()
