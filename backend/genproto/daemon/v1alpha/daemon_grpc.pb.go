// Code generated by protoc-gen-go-grpc. DO NOT EDIT.
// versions:
// - protoc-gen-go-grpc v1.5.1
// - protoc             v4.24.4
// source: daemon/v1alpha/daemon.proto

package daemon

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
	Daemon_GenMnemonic_FullMethodName             = "/com.seed.daemon.v1alpha.Daemon/GenMnemonic"
	Daemon_RegisterKey_FullMethodName             = "/com.seed.daemon.v1alpha.Daemon/RegisterKey"
	Daemon_GetInfo_FullMethodName                 = "/com.seed.daemon.v1alpha.Daemon/GetInfo"
	Daemon_ForceSync_FullMethodName               = "/com.seed.daemon.v1alpha.Daemon/ForceSync"
	Daemon_ForceReindex_FullMethodName            = "/com.seed.daemon.v1alpha.Daemon/ForceReindex"
	Daemon_ListKeys_FullMethodName                = "/com.seed.daemon.v1alpha.Daemon/ListKeys"
	Daemon_UpdateKey_FullMethodName               = "/com.seed.daemon.v1alpha.Daemon/UpdateKey"
	Daemon_DeleteKey_FullMethodName               = "/com.seed.daemon.v1alpha.Daemon/DeleteKey"
	Daemon_DeleteAllKeys_FullMethodName           = "/com.seed.daemon.v1alpha.Daemon/DeleteAllKeys"
	Daemon_StoreBlobs_FullMethodName              = "/com.seed.daemon.v1alpha.Daemon/StoreBlobs"
	Daemon_CreateDeviceLinkSession_FullMethodName = "/com.seed.daemon.v1alpha.Daemon/CreateDeviceLinkSession"
	Daemon_GetDeviceLinkSession_FullMethodName    = "/com.seed.daemon.v1alpha.Daemon/GetDeviceLinkSession"
	Daemon_SignData_FullMethodName                = "/com.seed.daemon.v1alpha.Daemon/SignData"
)

// DaemonClient is the client API for Daemon service.
//
// For semantics around ctx use and closing/ending streaming RPCs, please refer to https://pkg.go.dev/google.golang.org/grpc/?tab=doc#ClientConn.NewStream.
//
// Daemon API allows to control and administer the Seed Daemon.
type DaemonClient interface {
	// Generates a set of BIP-39-compatible mnemonic words encoding a cryptographic seed.
	// This is a stateless call, and the generated mnemonic is not stored anywhere.
	// Subsequent call to RegisterKey can be used to register a new signing key derived from the mnemonic.
	GenMnemonic(ctx context.Context, in *GenMnemonicRequest, opts ...grpc.CallOption) (*GenMnemonicResponse, error)
	// After generating the seed, this call is used to commit the seed and
	// create an account binding between the device and account.
	RegisterKey(ctx context.Context, in *RegisterKeyRequest, opts ...grpc.CallOption) (*NamedKey, error)
	// Get generic information about the running node.
	GetInfo(ctx context.Context, in *GetInfoRequest, opts ...grpc.CallOption) (*Info, error)
	// Force-trigger periodic background sync of Seed objects.
	ForceSync(ctx context.Context, in *ForceSyncRequest, opts ...grpc.CallOption) (*emptypb.Empty, error)
	// Forces the daemon to reindex the entire database.
	ForceReindex(ctx context.Context, in *ForceReindexRequest, opts ...grpc.CallOption) (*ForceReindexResponse, error)
	// Lists all the signing keys registered on this Daemon.
	ListKeys(ctx context.Context, in *ListKeysRequest, opts ...grpc.CallOption) (*ListKeysResponse, error)
	// Updates the existing key.
	UpdateKey(ctx context.Context, in *UpdateKeyRequest, opts ...grpc.CallOption) (*NamedKey, error)
	// Deletes a key from the underlying key store.
	DeleteKey(ctx context.Context, in *DeleteKeyRequest, opts ...grpc.CallOption) (*emptypb.Empty, error)
	// Deletes all Seed keys from the underlying key store.
	DeleteAllKeys(ctx context.Context, in *DeleteAllKeysRequest, opts ...grpc.CallOption) (*emptypb.Empty, error)
	// Receives raw blobs to be stored.
	// The request may fail if blobs can't be recognized by the daemon.
	StoreBlobs(ctx context.Context, in *StoreBlobsRequest, opts ...grpc.CallOption) (*StoreBlobsResponse, error)
	// Creates a new device link session.
	// The session information has to be transferred to the other device,
	// to establish a direct P2P connection between the devices, and complete the linking process.
	//
	// There can only be one active session at a time, and creating a new one will invalidate the previous one.
	//
	// After the session is redeemed, it becomes invalid.
	CreateDeviceLinkSession(ctx context.Context, in *CreateDeviceLinkSessionRequest, opts ...grpc.CallOption) (*DeviceLinkSession, error)
	// Get the current device link session (if it exists).
	GetDeviceLinkSession(ctx context.Context, in *GetDeviceLinkSessionRequest, opts ...grpc.CallOption) (*DeviceLinkSession, error)
	// Sign arbitrary data with an existing signing key.
	SignData(ctx context.Context, in *SignDataRequest, opts ...grpc.CallOption) (*SignDataResponse, error)
}

type daemonClient struct {
	cc grpc.ClientConnInterface
}

func NewDaemonClient(cc grpc.ClientConnInterface) DaemonClient {
	return &daemonClient{cc}
}

func (c *daemonClient) GenMnemonic(ctx context.Context, in *GenMnemonicRequest, opts ...grpc.CallOption) (*GenMnemonicResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(GenMnemonicResponse)
	err := c.cc.Invoke(ctx, Daemon_GenMnemonic_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) RegisterKey(ctx context.Context, in *RegisterKeyRequest, opts ...grpc.CallOption) (*NamedKey, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(NamedKey)
	err := c.cc.Invoke(ctx, Daemon_RegisterKey_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) GetInfo(ctx context.Context, in *GetInfoRequest, opts ...grpc.CallOption) (*Info, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(Info)
	err := c.cc.Invoke(ctx, Daemon_GetInfo_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) ForceSync(ctx context.Context, in *ForceSyncRequest, opts ...grpc.CallOption) (*emptypb.Empty, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(emptypb.Empty)
	err := c.cc.Invoke(ctx, Daemon_ForceSync_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) ForceReindex(ctx context.Context, in *ForceReindexRequest, opts ...grpc.CallOption) (*ForceReindexResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(ForceReindexResponse)
	err := c.cc.Invoke(ctx, Daemon_ForceReindex_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) ListKeys(ctx context.Context, in *ListKeysRequest, opts ...grpc.CallOption) (*ListKeysResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(ListKeysResponse)
	err := c.cc.Invoke(ctx, Daemon_ListKeys_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) UpdateKey(ctx context.Context, in *UpdateKeyRequest, opts ...grpc.CallOption) (*NamedKey, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(NamedKey)
	err := c.cc.Invoke(ctx, Daemon_UpdateKey_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) DeleteKey(ctx context.Context, in *DeleteKeyRequest, opts ...grpc.CallOption) (*emptypb.Empty, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(emptypb.Empty)
	err := c.cc.Invoke(ctx, Daemon_DeleteKey_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) DeleteAllKeys(ctx context.Context, in *DeleteAllKeysRequest, opts ...grpc.CallOption) (*emptypb.Empty, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(emptypb.Empty)
	err := c.cc.Invoke(ctx, Daemon_DeleteAllKeys_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) StoreBlobs(ctx context.Context, in *StoreBlobsRequest, opts ...grpc.CallOption) (*StoreBlobsResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(StoreBlobsResponse)
	err := c.cc.Invoke(ctx, Daemon_StoreBlobs_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) CreateDeviceLinkSession(ctx context.Context, in *CreateDeviceLinkSessionRequest, opts ...grpc.CallOption) (*DeviceLinkSession, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(DeviceLinkSession)
	err := c.cc.Invoke(ctx, Daemon_CreateDeviceLinkSession_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) GetDeviceLinkSession(ctx context.Context, in *GetDeviceLinkSessionRequest, opts ...grpc.CallOption) (*DeviceLinkSession, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(DeviceLinkSession)
	err := c.cc.Invoke(ctx, Daemon_GetDeviceLinkSession_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *daemonClient) SignData(ctx context.Context, in *SignDataRequest, opts ...grpc.CallOption) (*SignDataResponse, error) {
	cOpts := append([]grpc.CallOption{grpc.StaticMethod()}, opts...)
	out := new(SignDataResponse)
	err := c.cc.Invoke(ctx, Daemon_SignData_FullMethodName, in, out, cOpts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// DaemonServer is the server API for Daemon service.
// All implementations should embed UnimplementedDaemonServer
// for forward compatibility.
//
// Daemon API allows to control and administer the Seed Daemon.
type DaemonServer interface {
	// Generates a set of BIP-39-compatible mnemonic words encoding a cryptographic seed.
	// This is a stateless call, and the generated mnemonic is not stored anywhere.
	// Subsequent call to RegisterKey can be used to register a new signing key derived from the mnemonic.
	GenMnemonic(context.Context, *GenMnemonicRequest) (*GenMnemonicResponse, error)
	// After generating the seed, this call is used to commit the seed and
	// create an account binding between the device and account.
	RegisterKey(context.Context, *RegisterKeyRequest) (*NamedKey, error)
	// Get generic information about the running node.
	GetInfo(context.Context, *GetInfoRequest) (*Info, error)
	// Force-trigger periodic background sync of Seed objects.
	ForceSync(context.Context, *ForceSyncRequest) (*emptypb.Empty, error)
	// Forces the daemon to reindex the entire database.
	ForceReindex(context.Context, *ForceReindexRequest) (*ForceReindexResponse, error)
	// Lists all the signing keys registered on this Daemon.
	ListKeys(context.Context, *ListKeysRequest) (*ListKeysResponse, error)
	// Updates the existing key.
	UpdateKey(context.Context, *UpdateKeyRequest) (*NamedKey, error)
	// Deletes a key from the underlying key store.
	DeleteKey(context.Context, *DeleteKeyRequest) (*emptypb.Empty, error)
	// Deletes all Seed keys from the underlying key store.
	DeleteAllKeys(context.Context, *DeleteAllKeysRequest) (*emptypb.Empty, error)
	// Receives raw blobs to be stored.
	// The request may fail if blobs can't be recognized by the daemon.
	StoreBlobs(context.Context, *StoreBlobsRequest) (*StoreBlobsResponse, error)
	// Creates a new device link session.
	// The session information has to be transferred to the other device,
	// to establish a direct P2P connection between the devices, and complete the linking process.
	//
	// There can only be one active session at a time, and creating a new one will invalidate the previous one.
	//
	// After the session is redeemed, it becomes invalid.
	CreateDeviceLinkSession(context.Context, *CreateDeviceLinkSessionRequest) (*DeviceLinkSession, error)
	// Get the current device link session (if it exists).
	GetDeviceLinkSession(context.Context, *GetDeviceLinkSessionRequest) (*DeviceLinkSession, error)
	// Sign arbitrary data with an existing signing key.
	SignData(context.Context, *SignDataRequest) (*SignDataResponse, error)
}

// UnimplementedDaemonServer should be embedded to have
// forward compatible implementations.
//
// NOTE: this should be embedded by value instead of pointer to avoid a nil
// pointer dereference when methods are called.
type UnimplementedDaemonServer struct{}

func (UnimplementedDaemonServer) GenMnemonic(context.Context, *GenMnemonicRequest) (*GenMnemonicResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method GenMnemonic not implemented")
}
func (UnimplementedDaemonServer) RegisterKey(context.Context, *RegisterKeyRequest) (*NamedKey, error) {
	return nil, status.Errorf(codes.Unimplemented, "method RegisterKey not implemented")
}
func (UnimplementedDaemonServer) GetInfo(context.Context, *GetInfoRequest) (*Info, error) {
	return nil, status.Errorf(codes.Unimplemented, "method GetInfo not implemented")
}
func (UnimplementedDaemonServer) ForceSync(context.Context, *ForceSyncRequest) (*emptypb.Empty, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ForceSync not implemented")
}
func (UnimplementedDaemonServer) ForceReindex(context.Context, *ForceReindexRequest) (*ForceReindexResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ForceReindex not implemented")
}
func (UnimplementedDaemonServer) ListKeys(context.Context, *ListKeysRequest) (*ListKeysResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ListKeys not implemented")
}
func (UnimplementedDaemonServer) UpdateKey(context.Context, *UpdateKeyRequest) (*NamedKey, error) {
	return nil, status.Errorf(codes.Unimplemented, "method UpdateKey not implemented")
}
func (UnimplementedDaemonServer) DeleteKey(context.Context, *DeleteKeyRequest) (*emptypb.Empty, error) {
	return nil, status.Errorf(codes.Unimplemented, "method DeleteKey not implemented")
}
func (UnimplementedDaemonServer) DeleteAllKeys(context.Context, *DeleteAllKeysRequest) (*emptypb.Empty, error) {
	return nil, status.Errorf(codes.Unimplemented, "method DeleteAllKeys not implemented")
}
func (UnimplementedDaemonServer) StoreBlobs(context.Context, *StoreBlobsRequest) (*StoreBlobsResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method StoreBlobs not implemented")
}
func (UnimplementedDaemonServer) CreateDeviceLinkSession(context.Context, *CreateDeviceLinkSessionRequest) (*DeviceLinkSession, error) {
	return nil, status.Errorf(codes.Unimplemented, "method CreateDeviceLinkSession not implemented")
}
func (UnimplementedDaemonServer) GetDeviceLinkSession(context.Context, *GetDeviceLinkSessionRequest) (*DeviceLinkSession, error) {
	return nil, status.Errorf(codes.Unimplemented, "method GetDeviceLinkSession not implemented")
}
func (UnimplementedDaemonServer) SignData(context.Context, *SignDataRequest) (*SignDataResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method SignData not implemented")
}
func (UnimplementedDaemonServer) testEmbeddedByValue() {}

// UnsafeDaemonServer may be embedded to opt out of forward compatibility for this service.
// Use of this interface is not recommended, as added methods to DaemonServer will
// result in compilation errors.
type UnsafeDaemonServer interface {
	mustEmbedUnimplementedDaemonServer()
}

func RegisterDaemonServer(s grpc.ServiceRegistrar, srv DaemonServer) {
	// If the following call pancis, it indicates UnimplementedDaemonServer was
	// embedded by pointer and is nil.  This will cause panics if an
	// unimplemented method is ever invoked, so we test this at initialization
	// time to prevent it from happening at runtime later due to I/O.
	if t, ok := srv.(interface{ testEmbeddedByValue() }); ok {
		t.testEmbeddedByValue()
	}
	s.RegisterService(&Daemon_ServiceDesc, srv)
}

func _Daemon_GenMnemonic_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GenMnemonicRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).GenMnemonic(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_GenMnemonic_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).GenMnemonic(ctx, req.(*GenMnemonicRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_RegisterKey_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(RegisterKeyRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).RegisterKey(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_RegisterKey_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).RegisterKey(ctx, req.(*RegisterKeyRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_GetInfo_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetInfoRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).GetInfo(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_GetInfo_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).GetInfo(ctx, req.(*GetInfoRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_ForceSync_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ForceSyncRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).ForceSync(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_ForceSync_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).ForceSync(ctx, req.(*ForceSyncRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_ForceReindex_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ForceReindexRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).ForceReindex(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_ForceReindex_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).ForceReindex(ctx, req.(*ForceReindexRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_ListKeys_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListKeysRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).ListKeys(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_ListKeys_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).ListKeys(ctx, req.(*ListKeysRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_UpdateKey_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(UpdateKeyRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).UpdateKey(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_UpdateKey_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).UpdateKey(ctx, req.(*UpdateKeyRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_DeleteKey_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(DeleteKeyRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).DeleteKey(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_DeleteKey_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).DeleteKey(ctx, req.(*DeleteKeyRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_DeleteAllKeys_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(DeleteAllKeysRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).DeleteAllKeys(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_DeleteAllKeys_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).DeleteAllKeys(ctx, req.(*DeleteAllKeysRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_StoreBlobs_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(StoreBlobsRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).StoreBlobs(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_StoreBlobs_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).StoreBlobs(ctx, req.(*StoreBlobsRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_CreateDeviceLinkSession_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(CreateDeviceLinkSessionRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).CreateDeviceLinkSession(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_CreateDeviceLinkSession_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).CreateDeviceLinkSession(ctx, req.(*CreateDeviceLinkSessionRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_GetDeviceLinkSession_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetDeviceLinkSessionRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).GetDeviceLinkSession(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_GetDeviceLinkSession_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).GetDeviceLinkSession(ctx, req.(*GetDeviceLinkSessionRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _Daemon_SignData_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(SignDataRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(DaemonServer).SignData(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: Daemon_SignData_FullMethodName,
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(DaemonServer).SignData(ctx, req.(*SignDataRequest))
	}
	return interceptor(ctx, in, info, handler)
}

// Daemon_ServiceDesc is the grpc.ServiceDesc for Daemon service.
// It's only intended for direct use with grpc.RegisterService,
// and not to be introspected or modified (even as a copy)
var Daemon_ServiceDesc = grpc.ServiceDesc{
	ServiceName: "com.seed.daemon.v1alpha.Daemon",
	HandlerType: (*DaemonServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "GenMnemonic",
			Handler:    _Daemon_GenMnemonic_Handler,
		},
		{
			MethodName: "RegisterKey",
			Handler:    _Daemon_RegisterKey_Handler,
		},
		{
			MethodName: "GetInfo",
			Handler:    _Daemon_GetInfo_Handler,
		},
		{
			MethodName: "ForceSync",
			Handler:    _Daemon_ForceSync_Handler,
		},
		{
			MethodName: "ForceReindex",
			Handler:    _Daemon_ForceReindex_Handler,
		},
		{
			MethodName: "ListKeys",
			Handler:    _Daemon_ListKeys_Handler,
		},
		{
			MethodName: "UpdateKey",
			Handler:    _Daemon_UpdateKey_Handler,
		},
		{
			MethodName: "DeleteKey",
			Handler:    _Daemon_DeleteKey_Handler,
		},
		{
			MethodName: "DeleteAllKeys",
			Handler:    _Daemon_DeleteAllKeys_Handler,
		},
		{
			MethodName: "StoreBlobs",
			Handler:    _Daemon_StoreBlobs_Handler,
		},
		{
			MethodName: "CreateDeviceLinkSession",
			Handler:    _Daemon_CreateDeviceLinkSession_Handler,
		},
		{
			MethodName: "GetDeviceLinkSession",
			Handler:    _Daemon_GetDeviceLinkSession_Handler,
		},
		{
			MethodName: "SignData",
			Handler:    _Daemon_SignData_Handler,
		},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "daemon/v1alpha/daemon.proto",
}
