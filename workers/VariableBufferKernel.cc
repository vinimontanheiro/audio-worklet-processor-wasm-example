
#include "emscripten/bind.h"

using namespace emscripten;

class VariableBufferKernel {
 public:
  VariableBufferKernel(unsigned kernel_buffer_size)
      : kernel_buffer_size_(kernel_buffer_size),
        bytes_per_channel_(kernel_buffer_size * sizeof(float)) {}

  void Process(uintptr_t input_ptr, uintptr_t output_ptr,
               unsigned channel_count) {
    float* input_buffer = reinterpret_cast<float*>(input_ptr);
    float* output_buffer = reinterpret_cast<float*>(output_ptr);

    for (unsigned channel = 0; channel < channel_count; ++channel) {
      float* destination = output_buffer + channel * kernel_buffer_size_;
      if (channel < channel_count) {
        float* source = input_buffer + channel * kernel_buffer_size_;
        memcpy(destination, source, bytes_per_channel_);
      } else {
        memset(destination, 0, bytes_per_channel_);
      }
    }
  }

 private:
  unsigned kernel_buffer_size_ = 0;
  unsigned bytes_per_channel_ = 0;
};

EMSCRIPTEN_BINDINGS(CLASS_AWPKernelWithVariableBufferSize) {
  class_<VariableBufferKernel>("VariableBufferKernel")
      .constructor<unsigned>()
      .function("process",
                &VariableBufferKernel::Process,
                allow_raw_pointers());
}