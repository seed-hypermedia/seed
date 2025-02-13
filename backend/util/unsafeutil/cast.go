// Package unsafeutil provides convenience functions for various unsafe actions.
package unsafeutil

import (
	"fmt"
	"reflect"
	"unsafe"
)

// CheckStructLayout is a function that checks if two structs have the same memory layout,
// which is useful for unsafely casting between them.
// This function is useful for writing a test that would ensure that a duplicated struct has the same memory layout as the original.
func CheckStructLayout(a, b any) error {
	if a == nil || b == nil {
		panic("BUG: nil pointer passed to CheckStructLayout")
	}

	art := reflect.TypeOf(a)
	brt := reflect.TypeOf(b)

	if art.Kind() != reflect.Struct || brt.Kind() != reflect.Struct {
		return fmt.Errorf("both arguments must be structs")
	}

	if art.NumField() != brt.NumField() {
		return fmt.Errorf("number of fields must match: %T has %d fields while %T has %d fields", a, art.NumField(), b, brt.NumField())
	}

	for i := 0; i < art.NumField(); i++ {
		if art.Field(i).Type.String() != brt.Field(i).Type.String() {
			return fmt.Errorf("field types must match: %T field %d is %s while %T field %d is %s", a, i, art.Field(i).Type.String(), b, i, brt.Field(i).Type.String())
		}
	}

	if art.Size() != brt.Size() {
		return fmt.Errorf("struct sizes must match: %T has size %d while %T has size %d", a, art.Size(), b, brt.Size())
	}

	return nil
}

// Caster is a struct that unsafely casts one type into the other and vice versa.
type Caster[A, B any] struct{}

// NewCaster creates a new [Caster].
func NewCaster[A, B any](a A, b B) Caster[A, B] {
	if err := CheckStructLayout(a, b); err != nil {
		panic(err)
	}

	return Caster[A, B]{}
}

// Cast pointer A into pointer B.
func (Caster[A, B]) Cast(a *A) *B {
	return (*B)(unsafe.Pointer(a))
}

// RevCast casts pointer B into pointer A.
func (Caster[A, B]) RevCast(b *B) *A {
	return (*A)(unsafe.Pointer(b))
}

// CastValue is like Cast but uses values instead of pointers.
func (Caster[A, B]) CastValue(a A) B {
	return *(*B)(unsafe.Pointer(&a))
}

// RevCastValue is like RevCast but uses values instead of pointers.
func (Caster[A, B]) RevCastValue(b B) A {
	return *(*A)(unsafe.Pointer(&b))
}
