// Code generated by protoc-gen-go-grpc. DO NOT EDIT.
// versions:
// - protoc-gen-go-grpc v1.5.1
// - protoc             v4.24.4
// source: activity/v1alpha/subscriptions.proto

package activity

import (
	context "context"
	grpc "google.golang.org/grpc"
	codes "google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
	emptypb "google.golang.org/protobuf/types/known/emptypb"
)

// This is a compile-time assertion to ensure that this generated file
// is compatible with the grpc package it is being compiled against.
// Requires gRPC-Go v1.64.0 or later.
const _ = grpc.SupportPackageIsVersion9

const (
	Subscriptions_Subscribe_FullMethodName         = "/com.seed.activity.v1alpha.Subscriptions/Subscribe"
	Subscriptions_Unsubscribe_FullMethodName       = "/com.seed.activity.v1alpha.Subscriptions/Unsubscribe"
	Subscriptions_ListSubscriptions_FullMethodName = "/com.seed.activity.v1alpha.Subscriptions/ListSubscriptions"
)

// SubscriptionsClient is the client API for Subscriptions service.
//
// For semantics around ctx use and closing/ending streaming RPCs, please refer to https://pkg.go.dev/google.golang.org/grpc/?tab=doc#ClientConn.NewStream.
//
// Subscriptions service provides subscription capabilities.
type SubscriptionsClient interface {
	// Subscribe to a document or space.
	Subscribe(ctx context.Context, in *SubscribeRequest, opts ...grpc.CallOption) (*emptypb.Empty, error)
	// Remove a subscription.
	Unsubscribe(ctx context.Context, in *UnsubscribeRequest, opts ...grpc.CallOption) (*emptypb.Empty, error)
	// Lists active subscriptions.
	ListSubscriptions(ctx context.Context, in *ListSubscriptionsRequest, opts ...grpc.CallOption) (*ListSubscriptionsResponse, error)
}

type subscriptionsClient struct {
	cc grpc.ClientConnInterface
}

func NewSubscriptionsClient(cc grpc.ClientConnInterface) SubscriptionsClient {
	return &subscriptionsClient{cc}
}

func (c *subscriptionsClient) Subscribe(ctx context.Context, in *SubscribeRequest, opts ...grpc.CallOption) (*emptypb.Empty, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(emptypb.Empty)
	err := c.cc.Invoke(ctx, Subscriptions_Subscribe_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *subscriptionsClient) Unsubscribe(ctx context.Context, in *UnsubscribeRequest, opts ...grpc.CallOption) (*emptypb.Empty, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(emptypb.Empty)
	err := c.cc.Invoke(ctx, Subscriptions_Unsubscribe_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *subscriptionsClient) ListSubscriptions(ctx context.Context, in *ListSubscriptionsRequest, opts ...grpc.CallOption) (*ListSubscriptionsResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(ListSubscriptionsResponse)
	err := c.cc.Invoke(ctx, Subscriptions_ListSubscriptions_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// SubscriptionsServer is the server API for Subscriptions service.
// All implementations should embed UnimplementedSubscriptionsServer
// for forward compatibility.
//
// Subscriptions service provides subscription capabilities.
type SubscriptionsServer interface {
	// Subscribe to a document or space.
	Subscribe(context.Context, *SubscribeRequest) (*emptypb.Empty, error)
	// Remove a subscription.
	Unsubscribe(context.Context, *UnsubscribeRequest) (*emptypb.Empty, error)
	// Lists active subscriptions.
	ListSubscriptions(context.Context, *ListSubscriptionsRequest) (*ListSubscriptionsResponse, error)
}

// UnimplementedSubscriptionsServer should be embedded to have
// forward compatible implementations.
//
// NOTE: this should be embedded by value instead of pointer to avoid a nil
// pointer dereference when methods are called.
type UnimplementedSubscriptionsServer struct{}

func (UnimplementedSubscriptionsServer) Subscribe(context.Context, *SubscribeRequest) (*emptypb.Empty, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Subscribe not implemented")
}
func (UnimplementedSubscriptionsServer) Unsubscribe(context.Context, *UnsubscribeRequest) (*emptypb.Empty, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Unsubscribe not implemented")
}
func (UnimplementedSubscriptionsServer) ListSubscriptions(context.Context, *ListSubscriptionsRequest) (*ListSubscriptionsResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ListSubscriptions not implemented")
}
func (UnimplementedSubscriptionsServer) testEmbeddedByValue() {}

// UnsafeSubscriptionsServer may be embedded to opt out of forward compatibility for this service.
// Use of this interface is not recommended, as added methods to SubscriptionsServer will
// result in compilation errors.
type UnsafeSubscriptionsServer interface {
	mustEmbedUnimplementedSubscriptionsServer()
}

func RegisterSubscriptionsServer(s grpc.ServiceRegistrar, srv SubscriptionsServer) {
	// If the following call pancis, it indicates UnimplementedSubscriptionsServer was
	// embedded by pointer and is nil.  This will cause panics if an
	// unimplemented method is ever invoked, so we test this at initialization
	// time to prevent it from happening at runtime later due to I/O.
	if t, ok := srv.(interface{ testEmbeddedByValue() }); ok {
		t.testEmbeddedByValue()
	}
	s.RegisterService(&Subscriptions_ServiceDesc, srv)
}

func _Subscriptions_Subscribe_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(SubscribeRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(SubscriptionsServer).Subscribe(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Subscriptions_Subscribe_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(SubscriptionsServer).Subscribe(ctx, req.(*SubscribeRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Subscriptions_Unsubscribe_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(UnsubscribeRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(SubscriptionsServer).Unsubscribe(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Subscriptions_Unsubscribe_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(SubscriptionsServer).Unsubscribe(ctx, req.(*UnsubscribeRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Subscriptions_ListSubscriptions_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListSubscriptionsRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(SubscriptionsServer).ListSubscriptions(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Subscriptions_ListSubscriptions_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(SubscriptionsServer).ListSubscriptions(ctx, req.(*ListSubscriptionsRequest))
	}
	return interceptor(ctx, in, info, handler)
}

// Subscriptions_ServiceDesc is the grpc.ServiceDesc for Subscriptions service.
// It's only intended for direct use with grpc.RegisterService,
// and not to be introspected or modified (even as a copy)
var Subscriptions_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "com.seed.activity.v1alpha.Subscriptions",
	HandlerType: (*SubscriptionsServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "Subscribe",
			Handler:    _Subscriptions_Subscribe_Handler,
		},
		{
			MethodName: "Unsubscribe",
			Handler:    _Subscriptions_Unsubscribe_Handler,
		},
		{
			MethodName: "ListSubscriptions",
			Handler:    _Subscriptions_ListSubscriptions_Handler,
		},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "activity/v1alpha/subscriptions.proto",
}
