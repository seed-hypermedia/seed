// Code generated by protoc-gen-go-grpc. DO NOT EDIT.
// versions:
// - protoc-gen-go-grpc v1.5.1
// - protoc             v4.24.4
// source: networking/v1alpha/networking.proto

package networking

import (
	context "context"
	grpc "google.golang.org/grpc"
	codes "google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
)

// This is a compile-time assertion to ensure that this generated file
// is compatible with the grpc package it is being compiled against.
// Requires gRPC-Go v1.64.0 or later.
const _ = grpc.SupportPackageIsVersion9

const (
	Networking_GetPeerInfo_FullMethodName = "/com.seed.networking.v1alpha.Networking/GetPeerInfo"
	Networking_ListPeers_FullMethodName   = "/com.seed.networking.v1alpha.Networking/ListPeers"
	Networking_Connect_FullMethodName     = "/com.seed.networking.v1alpha.Networking/Connect"
)

// NetworkingClient is the client API for Networking service.
//
// For semantics around ctx use and closing/ending streaming RPCs, please refer to https://pkg.go.dev/google.golang.org/grpc/?tab=doc#ClientConn.NewStream.
//
// Networking API service of the Seed daemon.
type NetworkingClient interface {
	// Lookup details about a known peer.
	GetPeerInfo(ctx context.Context, in *GetPeerInfoRequest, opts ...grpc.CallOption) (*PeerInfo, error)
	// List peers by status.
	ListPeers(ctx context.Context, in *ListPeersRequest, opts ...grpc.CallOption) (*ListPeersResponse, error)
	// Establishes a direct connection with a given peer explicitly.
	Connect(ctx context.Context, in *ConnectRequest, opts ...grpc.CallOption) (*ConnectResponse, error)
}

type networkingClient struct {
	cc grpc.ClientConnInterface
}

func NewNetworkingClient(cc grpc.ClientConnInterface) NetworkingClient {
	return &networkingClient{cc}
}

func (c *networkingClient) GetPeerInfo(ctx context.Context, in *GetPeerInfoRequest, opts ...grpc.CallOption) (*PeerInfo, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(PeerInfo)
	err := c.cc.Invoke(ctx, Networking_GetPeerInfo_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *networkingClient) ListPeers(ctx context.Context, in *ListPeersRequest, opts ...grpc.CallOption) (*ListPeersResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(ListPeersResponse)
	err := c.cc.Invoke(ctx, Networking_ListPeers_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *networkingClient) Connect(ctx context.Context, in *ConnectRequest, opts ...grpc.CallOption) (*ConnectResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(ConnectResponse)
	err := c.cc.Invoke(ctx, Networking_Connect_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// NetworkingServer is the server API for Networking service.
// All implementations should embed UnimplementedNetworkingServer
// for forward compatibility.
//
// Networking API service of the Seed daemon.
type NetworkingServer interface {
	// Lookup details about a known peer.
	GetPeerInfo(context.Context, *GetPeerInfoRequest) (*PeerInfo, error)
	// List peers by status.
	ListPeers(context.Context, *ListPeersRequest) (*ListPeersResponse, error)
	// Establishes a direct connection with a given peer explicitly.
	Connect(context.Context, *ConnectRequest) (*ConnectResponse, error)
}

// UnimplementedNetworkingServer should be embedded to have
// forward compatible implementations.
//
// NOTE: this should be embedded by value instead of pointer to avoid a nil
// pointer dereference when methods are called.
type UnimplementedNetworkingServer struct{}

func (UnimplementedNetworkingServer) GetPeerInfo(context.Context, *GetPeerInfoRequest) (*PeerInfo, error) {
	return nil, status.Errorf(codes.Unimplemented, "method GetPeerInfo not implemented")
}
func (UnimplementedNetworkingServer) ListPeers(context.Context, *ListPeersRequest) (*ListPeersResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ListPeers not implemented")
}
func (UnimplementedNetworkingServer) Connect(context.Context, *ConnectRequest) (*ConnectResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Connect not implemented")
}
func (UnimplementedNetworkingServer) testEmbeddedByValue() {}

// UnsafeNetworkingServer may be embedded to opt out of forward compatibility for this service.
// Use of this interface is not recommended, as added methods to NetworkingServer will
// result in compilation errors.
type UnsafeNetworkingServer interface {
	mustEmbedUnimplementedNetworkingServer()
}

func RegisterNetworkingServer(s grpc.ServiceRegistrar, srv NetworkingServer) {
	// If the following call pancis, it indicates UnimplementedNetworkingServer was
	// embedded by pointer and is nil.  This will cause panics if an
	// unimplemented method is ever invoked, so we test this at initialization
	// time to prevent it from happening at runtime later due to I/O.
	if t, ok := srv.(interface{ testEmbeddedByValue() }); ok {
		t.testEmbeddedByValue()
	}
	s.RegisterService(&Networking_ServiceDesc, srv)
}

func _Networking_GetPeerInfo_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetPeerInfoRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(NetworkingServer).GetPeerInfo(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Networking_GetPeerInfo_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(NetworkingServer).GetPeerInfo(ctx, req.(*GetPeerInfoRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Networking_ListPeers_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListPeersRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(NetworkingServer).ListPeers(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Networking_ListPeers_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(NetworkingServer).ListPeers(ctx, req.(*ListPeersRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Networking_Connect_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ConnectRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(NetworkingServer).Connect(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Networking_Connect_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(NetworkingServer).Connect(ctx, req.(*ConnectRequest))
	}
	return interceptor(ctx, in, info, handler)
}

// Networking_ServiceDesc is the grpc.ServiceDesc for Networking service.
// It's only intended for direct use with grpc.RegisterService,
// and not to be introspected or modified (even as a copy)
var Networking_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "com.seed.networking.v1alpha.Networking",
	HandlerType: (*NetworkingServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "GetPeerInfo",
			Handler:    _Networking_GetPeerInfo_Handler,
		},
		{
			MethodName: "ListPeers",
			Handler:    _Networking_ListPeers_Handler,
		},
		{
			MethodName: "Connect",
			Handler:    _Networking_Connect_Handler,
		},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "networking/v1alpha/networking.proto",
}
