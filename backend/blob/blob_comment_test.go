package blob

import (
	"encoding/hex"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/ipfs"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/colx"
	"seed/backend/util/must"
	"strings"
	"testing"

	"github.com/ipfs/go-cid"
	cbornode "github.com/ipfs/go-ipld-cbor"
	"github.com/klauspost/compress/zstd"
	"github.com/multiformats/go-multicodec"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestCommentOldEncoding(t *testing.T) {
	// Real comment exctracted from the prod database.
	dbComment := "28B52FFD64C1110D3C002A6BA81543A02E87000C9EAB613DD8EAC83ABC34078B0BA134B293035656254A64F7FE29C9FE943EDBA6FFBF4FE9E293FC96D63A3D9250700C41BB44223C34FA609D2A8E22C06836440136014601BBEE8B67F52BFDE968E7AD7EE5747056D0E6A98CB7FC6A4D5EA7577A7E2A1F74116F97AE3F8F5BBE91BB3CBF28456D7B155C6A4A3918D49265B9C424C737A5EF662DD58B03CE7EADEEF99EF77E71DD32CCD8BB1527ADA82B75BCDDFA6F59B388B3284A7F70FB6B8CC1E978BB9575DFD7FA5D17A1E166574FFDAEDAF38871FEDD7ABFAA9FFA7D90C5BEAD581B644A1B9A4AD8B89FA9ADE004F51E314E22F9772BBD72EBFCF4CE4670C64CB09AC40CC26AF7E48EBEB86EB9F1BD929644FF1EBB9AF79650A028F327B394D517719B7E7ED07505B77FB7D6AA15F7ED378D41BBD552A5D7D36E11C18081B0DA39E181A3B8A33F4412B4E9C2264BA704854E9E195480267491CDC1C2A6681FD16FD0348992648969CC2B0B9930B1061608FC62858A680302C18A1D252320D818E3E24E8B1C3F2286E019E1F4553DFD4C132CE4C7C72782DEDD93B79794591C8A21D91D05F44511E7E9DFADDFB9DE598ABEAFDC198B61755A714D3ADEB7CA30FFBEFF72D70B15B0A7A75A8C85742083A6DF85AF6D5F6B8ECB6FADFC3C85C1356E572BC7A80DE057C19B18141424E437BF8941AA0F42EEFA5C65722BC3BAC5A4AA5FB322ADB4643F57B5D6384F4931FE5CFAAD72DF2A43C74DA9FC3929D9EE8C65E367DD5366996FFD45472F08228A1C86A102B6F4E4C6FD8BC510BF1CE8B6247343422C58E41A24A8E15303E8418D8BEB9EAF7DDFDF17CF542A251D9CA3F6B7EF6F3B99AB21DE7A9CAEA9E70737766B257D3DDB7694DEC3902035C140BAB3A6697BE06343EF2CB7F6A8C54534F760810D4DEFD32535F4BE1F8E13C3FC431CF38C3DFF5AD5A39DB7777D6157A757F4B08B786FE9FFC9B07AFE1A9E2EFD6B12F48DAFEBC75457B0C939E00F5B979EB1BF0D9E6ABAB55E1B82F28A23A7080F12DC6A9FD6D184E30F23E13F7A0A67494F2B90B167C3F63BA77F71DD556399BB54B06C33A60E05ADD10C64C0E0F8C3F6C17DE48AB9889B624944454576496F7012E1B6829261BC943D003D94D5F9865BB96B0B57E1CAF358512C8DE7E769A27B3FABBC0F710B0AD351EEF07AD9B6C149936EB6FB90E80A060876CDD24EFF3CEAFB8EB7EBD733CF2FE22C7AC6DEBC15976558B3A8C7898D8C04E14CC858323D44A49260E7663DD38A463FE7F73E8B4EEF88F3479BB2F37D3F4B515F99370637A142E619BB09D989B7D52844565265D96D6CC930CB314A4B3BCE5CA7831B777EAB67F9A228DDA58D60459B7527136BDA9CE0C8D8C8F5C5F348D7A651EEE9AB894F203CF81843AC55CBDB5D583D4A6453E55A897251DB76DE2DCA46438B5311E51588BBB5424BCBB5F4BEE576A579F533CD935D870E2EED89B5283E56DCA07004871027390653028468EAE89071B473B85183C7252500942636859E100E004E92A81F9F0B4E1ACED4F898183901C1E7269404A5E400480C1E202F6CC0EC08D2C2420F277A9BD969E2D0AAFCC8A1E094FF7E557B3B7E7E80194AD0609591A1A5C28F0B7B285CD98245663580002140CE8CA400764D9A1F39149C7E4A51FF7E7D7762CC6A332670B60A1A1AC51AD4C89A36DA143DEBB164383FDB928FBBAA4EB332F65A5073A8EAD0E695A6493BA3BED5D5EF704C2A5CD30B24616BA0F3D79C7EC6568F9EA2F2B7BE47CE413FC5A16FF0ABD6E9954ECB92BEEDAAAE35FF0E2743C7494FDDEA7A57D0E6193B6D4ADB9170975EF28C2D7E15196F94EDC38923F1C0000E198B388BF8C31657C3FCFB61EE0237AD2C387C10822D25C9464A2048C85D1BFCEAC7EE0D17D47D4F2B54E16DD9DAE28828F644C1DE75D4BEF577FE59BAB6725F9CAB19C7DC257BC188D956B31351327A3F0CF1FCECBAEEB10B80D220702200182AE401979C327ADA30C005AE16346A77368B3C5E0B03DA46E3C536161490A207C5D2C14F162954E69C8ED76DE6208258D588AAF17F888D668E007B203899DFDF864BEE160F442797683CD637C6B6623DA194BA8BE56D958B0C0A10C8F18FD9ACD205AB0EA6F3B9181B3026D2A145C022F70537B29A6123E9CC2DCE78DB71316902A24799F0CE11A75D1C4706EC5BDC4A381571CB09995ACC10DCB20F818C87ECD8BE11151D00BB08778A68C781B25D4BA46F1A50DA4018C3A09D0D373B9355AF09C8D7EED0C40887675789792C2E32480B9B10BEC1808C5074B5071717414EBB6E1331390EF14E278F44A01D414C87D66A02998A8F002ED4385A73BB78306BD6D66AE0220CB8303EA0DD856DFE80CE97D95CE4212CA43FC26F38446E378C7ED6CA2C3068685A89869BA6995FBDF78C321CF32DAC572BB842413746C0164DCDF710C60EC6C00545BC2B5A6384BD968863EB2D8F0B684898EB1D297FC3C297033B2D61BE96D394991C25D3AE7A12910A4543C6536DFCBA183D583F4C7EF972737C7198009028CF5F0439722B40EE7FAC8BDA16C7AD663D2B9184D75948CB223AD7E289C0EDC19BB8A1D0401CA079404051D1D4A44B78606ADCA168FDF40CE345C42C33809DA0C1F2155FB29102EC0A2E7326D2D60C05CF51B4BC7AB9FE15ADD25C90FC18602DCCE3308F0BBD756B4A0B14B5918F2F0D064831A0B23E96CC4404DFC8C637762159F476A38C2005E3CB9087"

	dataZstd, err := hex.DecodeString(dbComment)
	require.NoError(t, err)

	dec := must.Do2(zstd.NewReader(nil))

	data, err := dec.DecodeAll(dataZstd, nil)
	require.NoError(t, err)

	var comment map[string]any
	cbornode.DecodeInto(data, &comment)

	signer := core.Principal(comment["signer"].([]byte))
	sig := core.Signature(comment["sig"].([]byte))

	require.NoError(t, verifyBlob(signer, comment, sig))
}

func TestCommentCausality(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")
	c := ipfs.MustNewCID(multicodec.Raw, multicodec.Identity, []byte("fake-version"))
	clock := cclock.New()

	root, err := NewComment(alice.Account, "", alice.Account.Principal(), "", []cid.Cid{c}, cid.Undef, cid.Undef, []CommentBlock{
		{Block: Block{
			Type: "paragraph",
			Text: "Hello World",
		}},
	}, clock.MustNow())
	require.NoError(t, err)

	reply, err := NewComment(bob.Account, root.TSID(), root.Decoded.Space(), root.Decoded.Path, root.Decoded.Version, root.CID, cid.Undef, []CommentBlock{
		{Block: Block{
			Type: "paragraph",
			Text: "I reply",
		}},
	}, clock.MustNow())
	require.NoError(t, err)

	reply2, err := NewComment(bob.Account, root.TSID(), root.Decoded.Space(), root.Decoded.Path, root.Decoded.Version, root.CID, reply.CID, []CommentBlock{
		{Block: Block{
			Type: "paragraph",
			Text: "I reply to reply",
		}},
	}, clock.MustNow())

	blobs := colx.SlicePermutations([]struct {
		Name string
		Encoded[*Comment]
	}{
		{"root", root},
		{"reply", reply},
		{"reply2", reply2},
	})
	for _, test := range blobs {
		order := make([]string, len(test))
		for i, b := range test {
			order[i] = b.Name
		}

		t.Run(strings.Join(order, "+"), func(t *testing.T) {
			db := storage.MakeTestDB(t)
			idx, err := OpenIndex(t.Context(), db, zap.NewNop())
			require.NoError(t, err)
			for _, blob := range test {
				require.NoError(t, idx.Put(t.Context(), blob))
			}
			if countStashedBlobs(t, db) != 0 {
				t.Fatal("must have no stashed blobs")
			}
		})
	}
}
