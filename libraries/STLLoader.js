/**
 * @author mrdoob / http://mrdoob.com/
 */

( function () {

	class STLLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );

		}

		load( url, onLoad, onProgress, onError ) {

			const scope = this;

			const loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( text ) {

				try {

					onLoad( scope.parse( text ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

		parse( data ) {

			const isBinary = function () {

				let expect, face_size, n_faces, binary = false;
				const reader = new DataView( data );
				const faces = reader.getUint32( 80, true );
				const dataLength = data.byteLength;

				if ( dataLength === 84 + faces * 50 ) {

					binary = true;

				}

				return binary;

			};

			if ( isBinary() ) {

				return this.parseBinary( data );

			} else {

				return this.parseASCII( this.ensureString( data ) );

			}

		}

		parseBinary( data ) {

			const reader = new DataView( data );
			const faces = reader.getUint32( 80, true );

			let dataOffset = 84;
			const positions = [];
			const normals = [];
			const uvs = [];

			for ( let i = 0; i < faces; i ++ ) {

				// normal
				let normal = new THREE.Vector3(
					reader.getFloat32( dataOffset, true ),
					reader.getFloat32( dataOffset + 4, true ),
					reader.getFloat32( dataOffset + 8, true )
				);
				dataOffset += 12;

				// vertices
				for ( let j = 0; j < 3; j ++ ) {

					positions.push( reader.getFloat32( dataOffset, true ) );
					positions.push( reader.getFloat32( dataOffset + 4, true ) );
					positions.push( reader.getFloat32( dataOffset + 8, true ) );
					dataOffset += 12;

					normals.push( normal.x, normal.y, normal.z );

				}

				dataOffset += 2; // skip attribute byte count

			}

			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
			geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );

			return geometry;

		}

		parseASCII( data ) {

			const vertices = [];
			const normals = [];

			const result = data.match( /facet normal ([\s\S]*?) outer loop([\s\S]*?)endloop/g );

			for ( let i = 0; i < result.length; i ++ ) {

				const normalMatch = result[ i ].match( /facet normal\s+([-\+]?\d+\.?\d*([eE][-\+]?\d+)?)\s+([-\+]?\d+\.?\d*([eE][-\+]?\d+)?)\s+([-\+]?\d+\.?\d*([eE][-\+]?\d+)?)/ );

				const normal = new THREE.Vector3(
					parseFloat( normalMatch[ 1 ] ),
					parseFloat( normalMatch[ 3 ] ),
					parseFloat( normalMatch[ 5 ] )
				);

				const vertexMatch = result[ i ].match( /vertex\s+([-\+]?\d+\.?\d*([eE][-\+]?\d+)?)\s+([-\+]?\d+\.?\d*([eE][-\+]?\d+)?)\s+([-\+]?\d+\.?\d*([eE][-\+]?\d+)?)/g );

				for ( let j = 0; j < vertexMatch.length; j ++ ) {

					const vertex = vertexMatch[ j ].match( /vertex\s+([-\+]?\d+\.?\d*([eE][-\+]?\d+)?)\s+([-\+]?\d+\.?\d*([eE][-\+]?\d+)?)\s+([-\+]?\d+\.?\d*([eE][-\+]?\d+)?)/ );

					vertices.push( parseFloat( vertex[ 1 ] ), parseFloat( vertex[ 3 ] ), parseFloat( vertex[ 5 ] ) );
					normals.push( normal.x, normal.y, normal.z );

				}

			}

			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
			geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );

			return geometry;

		}

		ensureString( buf ) {

			if ( typeof buf !== 'string' ) {

				let array_buffer = new Uint8Array( buf );
				let str = '';

				for ( let i = 0; i < buf.byteLength; i ++ ) {

					str += String.fromCharCode( array_buffer[ i ] );

				}

				return str;

			} else {

				return buf;

			}

		}

	}

	THREE.STLLoader = STLLoader;

} )();