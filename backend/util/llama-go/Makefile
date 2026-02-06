.PHONY: test clean

INCLUDE_PATH := $(abspath ./)
LIBRARY_PATH := $(abspath ./)

ifndef UNAME_S
UNAME_S := $(shell uname -s)
endif

ifndef UNAME_P
UNAME_P := $(shell uname -p)
endif

ifndef UNAME_M
UNAME_M := $(shell uname -m)
endif

CCV := $(shell $(CC) --version | head -n 1)
CXXV := $(shell $(CXX) --version | head -n 1)

# Mac OS + Arm can report x86_64
# ref: https://github.com/ggerganov/whisper.cpp/issues/66#issuecomment-1282546789
ifeq ($(UNAME_S),Darwin)
	ifneq ($(UNAME_P),arm)
		SYSCTL_M := $(shell sysctl -n hw.optional.arm64 2>/dev/null)
		ifeq ($(SYSCTL_M),1)
			# UNAME_P := arm
			# UNAME_M := arm64
			warn := $(warning Your arch is announced as x86_64, but it seems to actually be ARM64. Not fixing that can lead to bad performance. For more info see: https://github.com/ggerganov/whisper.cpp/issues/66\#issuecomment-1282546789)
		endif
	endif
endif

#
# Compile flags
#

BUILD_TYPE?=
# keep standard at C11 and C++17
CFLAGS   = -I./llama.cpp -I. -O3 -DNDEBUG -std=c11 -fPIC
CXXFLAGS = -I./llama.cpp -I. -I./llama.cpp/common -I./common -I./llama.cpp/ggml/include -I./llama.cpp/include -I./llama.cpp/vendor -O3 -DNDEBUG -std=c++17 -fPIC
LDFLAGS  =

# warnings
CFLAGS   += -Wall -Wextra -Wpedantic -Wcast-qual -Wdouble-promotion -Wshadow -Wstrict-prototypes -Wpointer-arith -Wno-unused-function
CXXFLAGS += -Wall -Wextra -Wpedantic -Wcast-qual -Wno-unused-function

# OS specific
# TODO: support Windows
ifeq ($(UNAME_S),Linux)
	CFLAGS   += -pthread
	CXXFLAGS += -pthread
endif
ifeq ($(UNAME_S),Darwin)
	CFLAGS   += -pthread
	CXXFLAGS += -pthread -stdlib=libc++
	LDFLAGS  += -stdlib=libc++
endif
ifeq ($(UNAME_S),FreeBSD)
	CFLAGS   += -pthread
	CXXFLAGS += -pthread
endif
ifeq ($(UNAME_S),NetBSD)
	CFLAGS   += -pthread
	CXXFLAGS += -pthread
endif
ifeq ($(UNAME_S),OpenBSD)
	CFLAGS   += -pthread
	CXXFLAGS += -pthread
endif
ifeq ($(UNAME_S),Haiku)
	CFLAGS   += -pthread
	CXXFLAGS += -pthread
endif

# GPGPU specific
GGML_CUDA_OBJ_PATH=ggml/src/ggml-cuda/CMakeFiles/ggml-cuda.dir/ggml-cuda.cu.o


# Architecture specific
# TODO: probably these flags need to be tweaked on some architectures
#       feel free to update the Makefile for your architecture and send a pull request or issue
ifeq ($(UNAME_M),$(filter $(UNAME_M),x86_64 i686))
	# Use all CPU extensions that are available:
	CFLAGS += -march=native -mtune=native
endif
ifneq ($(filter ppc64%,$(UNAME_M)),)
	POWER9_M := $(shell grep "POWER9" /proc/cpuinfo)
	ifneq (,$(findstring POWER9,$(POWER9_M)))
		CFLAGS += -mcpu=power9
		CXXFLAGS += -mcpu=power9
	endif
	# Require c++23's std::byteswap for big-endian support.
	ifeq ($(UNAME_M),ppc64)
		CXXFLAGS += -std=c++23 -DGGML_BIG_ENDIAN
	endif
endif
ifndef LLAMA_NO_ACCELERATE
	# Mac M1 - include Accelerate framework.
	# `-framework Accelerate` works on Mac Intel as well, with negliable performance boost (as of the predict time).
	ifeq ($(UNAME_S),Darwin)
		CFLAGS  += -DGGML_USE_ACCELERATE
		LDFLAGS += -framework Accelerate
	endif
endif
ifdef LLAMA_OPENBLAS
	CFLAGS  += -DGGML_USE_OPENBLAS -I/usr/local/include/openblas
	LDFLAGS += -lopenblas
endif
ifdef LLAMA_GPROF
	CFLAGS   += -pg
	CXXFLAGS += -pg
endif
ifneq ($(filter aarch64%,$(UNAME_M)),)
	CFLAGS += -mcpu=native
	CXXFLAGS += -mcpu=native
endif
ifneq ($(filter armv6%,$(UNAME_M)),)
	# Raspberry Pi 1, 2, 3
	CFLAGS += -mfpu=neon-fp-armv8 -mfp16-format=ieee -mno-unaligned-access
endif
ifneq ($(filter armv7%,$(UNAME_M)),)
	# Raspberry Pi 4
	CFLAGS += -mfpu=neon-fp-armv8 -mfp16-format=ieee -mno-unaligned-access -funsafe-math-optimizations
endif
ifneq ($(filter armv8%,$(UNAME_M)),)
	# Raspberry Pi 4
	CFLAGS += -mfp16-format=ieee -mno-unaligned-access
endif

ifeq ($(BUILD_TYPE),openblas)
	EXTRA_LIBS=
	CMAKE_ARGS+=-DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS -DBLAS_INCLUDE_DIRS=/usr/include/openblas
endif

ifeq ($(BUILD_TYPE),blis)
	EXTRA_LIBS=
	CMAKE_ARGS+=-DGGML_BLAS=ON -DGGML_BLAS_VENDOR=FLAME
endif

ifeq ($(BUILD_TYPE),cublas)
	EXTRA_LIBS=
	CMAKE_ARGS+=-DGGML_CUDA=ON -DGGML_CUDA_FA_ALL_QUANTS=ON -DGGML_CUDA_GRAPHS=ON
	CXXFLAGS+=-DGGML_USE_CUDA
	ifdef CUDA_ARCHITECTURES
		CMAKE_ARGS+=-DCMAKE_CUDA_ARCHITECTURES="$(CUDA_ARCHITECTURES)"
	endif
	EXTRA_TARGETS+=llama.cpp/ggml-cuda.o
endif

ifeq ($(BUILD_TYPE),hipblas)
	ROCM_HOME ?= "/opt/rocm"
	CXX="$(ROCM_HOME)"/llvm/bin/clang++
	CC="$(ROCM_HOME)"/llvm/bin/clang
	EXTRA_LIBS=
	GPU_TARGETS ?= gfx900,gfx90a,gfx1030,gfx1031,gfx1100
	AMDGPU_TARGETS ?= "$(GPU_TARGETS)"
	CMAKE_ARGS+=-DGGML_HIP=ON -DAMDGPU_TARGETS="$(AMDGPU_TARGETS)" -DGPU_TARGETS="$(GPU_TARGETS)"
	CXXFLAGS+=-DGGML_USE_HIP
	EXTRA_TARGETS+=llama.cpp/ggml-cuda.o
	GGML_CUDA_OBJ_PATH=ggml/src/ggml-hip/CMakeFiles/ggml-hip.dir/ggml-cuda.cu.o
endif

ifeq ($(BUILD_TYPE),clblas)
	EXTRA_LIBS=
	CMAKE_ARGS+=-DGGML_OPENCL=ON
	EXTRA_TARGETS+=llama.cpp/ggml-opencl.o
endif

ifeq ($(BUILD_TYPE),metal)
	EXTRA_LIBS=
	CGO_LDFLAGS+="-framework Accelerate -framework Foundation -framework Metal -framework MetalKit -framework MetalPerformanceShaders"
	CMAKE_ARGS+=-DGGML_METAL=ON
endif

ifeq ($(BUILD_TYPE),vulkan)
	EXTRA_LIBS=
	CMAKE_ARGS+=-DGGML_VULKAN=ON
endif

ifdef CLBLAST_DIR
	CMAKE_ARGS+=-DCLBlast_dir=$(CLBLAST_DIR)
endif

# TODO: support Windows
ifeq ($(GPU_TESTS),true)
	CGO_LDFLAGS="-lcublas -lcudart -L/usr/local/cuda/lib64/"
	TEST_LABEL=gpu
else
	TEST_LABEL=!gpu
endif

#
# Print build information
#

$(info I llama.cpp build info: )
$(info I UNAME_S:  $(UNAME_S))
$(info I UNAME_P:  $(UNAME_P))
$(info I UNAME_M:  $(UNAME_M))
$(info I CFLAGS:   $(CFLAGS))
$(info I CXXFLAGS: $(CXXFLAGS))
$(info I CGO_LDFLAGS:  $(CGO_LDFLAGS))
$(info I LDFLAGS:  $(LDFLAGS))
$(info I BUILD_TYPE:  $(BUILD_TYPE))
$(info I CMAKE_ARGS:  $(CMAKE_ARGS))
$(info I EXTRA_TARGETS:  $(EXTRA_TARGETS))
$(info I CC:       $(CCV))
$(info I CXX:      $(CXXV))
$(info )

# Use this if you want to set the default behavior


llama.cpp/ggml-alloc.o: llama.cpp/ggml.o
	cd build && cp -rf ggml/src/CMakeFiles/ggml-base.dir/ggml-alloc.c.o ../llama.cpp/ggml-alloc.o

llama.cpp/ggml.o:
	mkdir -p build
	cd build && CC="$(CC)" CXX="$(CXX)" cmake ../llama.cpp $(CMAKE_ARGS) -DLLAMA_CURL=OFF && VERBOSE=1 cmake --build . --config Release -j 8 --target ggml llama && cp -rf ggml/src/CMakeFiles/ggml-base.dir/ggml.c.o ../llama.cpp/ggml.o

llama.cpp/ggml-cuda.o: llama.cpp/ggml.o
	cd build && cp -rf "$(GGML_CUDA_OBJ_PATH)" ../llama.cpp/ggml-cuda.o

llama.cpp/ggml-opencl.o: llama.cpp/ggml.o
	cd build && cp -rf CMakeFiles/ggml.dir/ggml-opencl.cpp.o ../llama.cpp/ggml-opencl.o

llama.cpp/k_quants.o: llama.cpp/ggml.o
	cd build && cp -rf ggml/src/CMakeFiles/ggml-base.dir/ggml-quants.c.o ../llama.cpp/k_quants.o

llama.cpp/llama.o: llama.cpp/ggml.o
	cd build && cp -rf src/CMakeFiles/llama.dir/llama.cpp.o ../llama.cpp/llama.o

llama.cpp/common.o: llama.cpp/ggml.o
	$(CXX) $(CXXFLAGS) -I./llama.cpp -I./llama.cpp/common -I./llama.cpp/ggml/include -I./llama.cpp/include llama.cpp/common/common.cpp -o llama.cpp/common.o -c $(LDFLAGS)

llama.cpp/sampling.o: llama.cpp/ggml.o
	$(CXX) $(CXXFLAGS) -I./llama.cpp -I./llama.cpp/common -I./llama.cpp/ggml/include -I./llama.cpp/include llama.cpp/common/sampling.cpp -o llama.cpp/sampling.o -c $(LDFLAGS)

llama.cpp/log.o: llama.cpp/ggml.o
	$(CXX) $(CXXFLAGS) -I./llama.cpp -I./llama.cpp/common -I./llama.cpp/ggml/include -I./llama.cpp/include llama.cpp/common/log.cpp -o llama.cpp/log.o -c $(LDFLAGS)

wrapper.o:
	$(CXX) $(CXXFLAGS) -I./llama.cpp -I./llama.cpp/common -I./llama.cpp/ggml/include -I./llama.cpp/include wrapper.cpp -o wrapper.o -c $(LDFLAGS)

# All Go bindings are now handled through wrapper.cpp

libbinding.a: llama.cpp/ggml.o wrapper.o $(EXTRA_TARGETS)
	cd build && cmake --build . --target common -j 8
	ar crs libbinding.a wrapper.o $(EXTRA_TARGETS)
	cp build/common/libcommon.a .
ifneq (,$(findstring -DBUILD_SHARED_LIBS=OFF,$(CMAKE_ARGS)))
	@echo "Copying static libraries..."
	cp build/src/libllama.a .
	cp build/ggml/src/libggml.a .
	cp build/ggml/src/libggml-base.a .
	cp build/ggml/src/libggml-cpu.a .
ifeq ($(BUILD_TYPE),openblas)
	cp build/ggml/src/ggml-blas/libggml-blas.a .
endif
ifeq ($(BUILD_TYPE),vulkan)
	cp build/ggml/src/ggml-vulkan/libggml-vulkan.a .
endif
ifeq ($(BUILD_TYPE),metal)
	cp build/ggml/src/ggml-metal/libggml-metal.a .
endif
else
	@echo "Copying shared libraries..."
	cp build/bin/libllama.so .
	cp build/bin/libggml.so .
	cp build/bin/libggml-base.so .
	cp build/bin/libggml-cpu.so .
ifeq ($(BUILD_TYPE),cublas)
	cp build/bin/libggml-cuda.so .
endif
ifeq ($(BUILD_TYPE),openblas)
	cp build/bin/libggml-blas.so .
endif
ifeq ($(BUILD_TYPE),vulkan)
	cp build/bin/libggml-vulkan.so .
endif
endif

clean:
	rm -rf *.o
	rm -rf *.a
	rm -rf *.so
	rm -rf llama.cpp/*.o
	cd llama.cpp && git checkout -- . && git clean -fd
	rm -rf build

ggllm-test-model.bin:
	wget -q https://huggingface.co/TheBloke/CodeLlama-7B-Instruct-GGUF/resolve/main/codellama-7b-instruct.Q2_K.gguf -O ggllm-test-model.bin

test: ggllm-test-model.bin libbinding.a
	C_INCLUDE_PATH=${INCLUDE_PATH} CGO_LDFLAGS=${CGO_LDFLAGS} LIBRARY_PATH=${LIBRARY_PATH} TEST_MODEL=ggllm-test-model.bin go run github.com/onsi/ginkgo/v2/ginkgo --label-filter="$(TEST_LABEL)" --flake-attempts 5 -v -r ./...
